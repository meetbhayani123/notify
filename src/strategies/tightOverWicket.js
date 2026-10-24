/**
 * strategies/tightOverWicket.js
 * "Tight over wicket" trick — T20, 2nd innings only. One trick, two ways in:
 *
 *   A — an over took a wicket and finished having gone for TIGHT_OVER_MAX_RUNS
 *       or fewer → alert on that over.
 *   B — an over took a wicket but went for more than that, so the very next
 *       over is watched: a wicket there alerts too, whatever it goes for.
 *
 * The rule itself lives in helpers/tightOverRule.js. This module supplies it
 * with data and turns its verdict into an alert.
 *
 * The live-matches feed carries no per-over detail, so the figures come from
 * the match-state endpoint. It is asked for only when something that could
 * change the verdict has happened — an over finished, or a wicket fell —
 * which holds it to roughly one request per over plus one per wicket.
 */

const { getOverHistory } = require('../api/overHistory');
const { evaluateOver } = require('../helpers/tightOverRule');
const { resolveTeamName } = require('../api/teamResolver');
const { isT20Match, isMatchFinished } = require('../helpers/matchHelpers');
const { enrichedMatchLabel } = require('../helpers/matchFilter');
const { isOverEvaluated, saveOverOutcome } = require('../db/tightOverTrickStore');
const { sendTrickAlert } = require('../services/telegram');
const { TIGHT_OVER_MAX_RUNS } = require('../config');
const logger = require('../lib/logger');

const processing = new Set();
// `${matchId}_${innings}` → { completedOvers, wickets } as last seen in the feed
const lastSeen = new Map();

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Has anything happened that could change a verdict since the last tick?
 * An over finishing can settle path A; a wicket falling can settle path B.
 */
function somethingChanged(matchId, score, completedOvers) {
  const key = `${matchId}_${score.innings}`;
  const previous = lastSeen.get(key);
  lastSeen.set(key, { completedOvers, wickets: score.wickets });

  if (!previous) return true; // first sight of this innings
  return completedOvers > previous.completedOvers || score.wickets > previous.wickets;
}

/**
 * Turn a qualifying verdict into an alert, and record the outcome either way.
 */
async function reportOver(matchId, innings, verdict, match) {
  const { over, previousOver, trigger } = verdict;
  const battingTeam = await resolveTeamName(over.battingTeamKey);

  if (!verdict.qualifies) {
    logger.info(
      `🎯 [TIGHT OVER SKIPPED] Match ${matchId} over ${over.over} — ` +
      `${plural(over.runs, 'run')}, ${plural(over.wickets, 'wicket')}.`
    );
    await saveOverOutcome({
      matchId, innings, over: over.over, battingTeam,
      runs: over.runs, wickets: over.wickets, status: 'SKIPPED'
    });
    return;
  }

  const { label, matchInfo } = await enrichedMatchLabel(matchId, match);
  const afterTheExpensiveOver = trigger === 'WICKET_AFTER_EXPENSIVE_OVER';

  const headline = afterTheExpensiveOver
    ? `*${battingTeam}*  ·  wicket in over *${over.over}*, straight after over *${previousOver.over}*`
    : `*${battingTeam}*  ·  over *${over.over}* went for *${over.runs}* with ${plural(over.wickets, 'wicket')}`;

  const detailLines = afterTheExpensiveOver
    ? [
        `⚡ Over ${previousOver.over} took ${plural(previousOver.wickets, 'wicket')} but went for ${previousOver.runs}`,
        `🎯 Wicket in the very next over${over.runs !== null ? ` — ${plural(over.runs, 'run')} so far` : ''}`
      ]
    : [
        `⚡ Wicket fell and the over went for ${TIGHT_OVER_MAX_RUNS} or fewer`
      ];

  if (over.scoreAfter) {
    detailLines.push(`📊 Score: *${over.scoreAfter.runs}/${over.scoreAfter.wickets}*`);
  }

  logger.success(
    `🎯 [TIGHT OVER WICKET — ${trigger}] Match ${label} over ${over.over} — ` +
    `${plural(over.runs, 'run')}, ${plural(over.wickets, 'wicket')}. ALERT!`
  );

  try {
    await sendTrickAlert({
      title: `🎯 *TIGHT OVER — WICKET*`,
      headline,
      detailLines,
      matchLabel: label,
      innings,
      matchInfo
    });
    await saveOverOutcome({
      matchId, innings, over: over.over, battingTeam,
      runs: over.runs, wickets: over.wickets, status: 'NOTIFIED'
    });
  } catch (err) {
    logger.error(`Telegram send failed for tight-over wicket (match ${matchId} over ${over.over}):`, err);
    await saveOverOutcome({
      matchId, innings, over: over.over, battingTeam,
      runs: over.runs, wickets: over.wickets, status: 'SEND_FAILED'
    });
  }
}

/**
 * Entry point — called once per live match per poll tick.
 */
async function handleTightOverWicket(matchId, score, match) {
  if (!isT20Match(match)) return;
  if (score.innings !== 2) return;
  // A finished match lingers in the live feed; without this it would replay
  // every qualifying over still inside the API's window on the next restart.
  if (isMatchFinished(match)) return;

  const completedOvers = Math.floor(score.balls / 6);
  if (completedOvers < 1) return;

  if (!somethingChanged(matchId, score, completedOvers)) return;

  // The over just finished (path A), the one being bowled (path B), and one
  // over of slack so a missed tick does not lose an over outright.
  const candidates = [];
  for (let over = Math.max(1, completedOvers - 1); over <= completedOvers + 1; over++) {
    if (!(await isOverEvaluated(matchId, score.innings, over))) candidates.push(over);
  }
  if (candidates.length === 0) return;

  const stateKey = `${matchId}_${score.innings}`;
  if (processing.has(stateKey)) return;
  processing.add(stateKey);

  try {
    const result = await getOverHistory(matchId, { force: true });
    if (!result || result.history.length === 0) return;

    // Cross-check: the window must belong to a chase that is actually under way.
    if (!result.secondInningsStarted) {
      logger.warn(`Match ${matchId} — over history does not show a 2nd innings yet, skipping tight-over check.`);
      return;
    }

    for (const over of candidates) {
      const verdict = evaluateOver(result.history, over);
      if (!verdict.evaluable) continue; // not settled — looked at again next time
      await reportOver(matchId, score.innings, verdict, match);
    }
  } catch (err) {
    logger.error(`Error during tight-over wicket check for match ${matchId}:`, err);
  } finally {
    processing.delete(stateKey);
  }
}

/**
 * Drop per-match state for matches that are no longer live.
 */
function pruneTightOverState(activeMatchIds) {
  const active = new Set(activeMatchIds);
  for (const key of lastSeen.keys()) {
    if (!active.has(key.split('_')[0])) lastSeen.delete(key);
  }
}

module.exports = { handleTightOverWicket, pruneTightOverState };
