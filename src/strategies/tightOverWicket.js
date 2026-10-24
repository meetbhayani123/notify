/**
 * strategies/tightOverWicket.js
 * "Tight over wicket" trick — T20, 2nd innings only.
 *
 * Every completed over is judged on its own:
 *   a wicket fell in the over AND the over went for TIGHT_OVER_MAX_RUNS or fewer
 *     → alert
 *
 * An over that does not qualify stops nothing; the next over is judged the same
 * way, so the trick can fire several times in one innings — once per over.
 *
 * The live-matches feed carries no per-over detail, so the per-over figures come
 * from the match-state endpoint, requested only when an over has just completed.
 *
 * An over is judged only once a LATER over appears in the API's rolling window,
 * which is what proves the over finished and its runs are final. The cost is
 * that a qualifying final over of an innings is never reported — by then there
 * is no following over to act on, so nothing useful is lost.
 */

const { getOverHistory } = require('../api/overHistory');
const { findOver } = require('../helpers/overParser');
const { resolveTeamName } = require('../api/teamResolver');
const { isT20Match, isMatchFinished } = require('../helpers/matchHelpers');
const { enrichedMatchLabel } = require('../helpers/matchFilter');
const { isOverEvaluated, saveOverOutcome } = require('../db/tightOverTrickStore');
const { sendTrickAlert } = require('../services/telegram');
const { TIGHT_OVER_MAX_RUNS } = require('../config');
const logger = require('../lib/logger');

const processing = new Set();
// `${matchId}_${innings}` → the completed-over count we last forced a fetch for,
// so a freshly finished over bypasses the cache exactly once.
const lastForcedOver = new Map();

/**
 * Judge one completed over and alert when it qualifies.
 */
async function judgeOver(matchId, innings, entry, match) {
  const qualifies = entry.wickets >= 1 && entry.runs <= TIGHT_OVER_MAX_RUNS;
  const battingTeam = await resolveTeamName(entry.battingTeamKey);

  if (!qualifies) {
    logger.info(
      `🎯 [TIGHT OVER SKIPPED] Match ${matchId} over ${entry.over} — ` +
      `${entry.runs} run(s), ${entry.wickets} wicket(s).`
    );
    await saveOverOutcome({
      matchId, innings, over: entry.over, battingTeam,
      runs: entry.runs, wickets: entry.wickets, status: 'SKIPPED'
    });
    return;
  }

  const { label, matchInfo } = await enrichedMatchLabel(matchId, match);
  const wicketWord = entry.wickets === 1 ? 'wicket' : 'wickets';

  logger.success(
    `🎯 [TIGHT OVER WICKET] Match ${label} over ${entry.over} — ` +
    `${entry.runs} run(s) and ${entry.wickets} ${wicketWord}. ALERT!`
  );

  try {
    await sendTrickAlert({
      title: `🎯 *TIGHT OVER — WICKET*`,
      headline: `*${battingTeam}*  ·  over *${entry.over}* went for *${entry.runs}* with *${entry.wickets}* ${wicketWord}`,
      detailLines: [
        `⚡ Wicket fell and the over went for ${TIGHT_OVER_MAX_RUNS} or fewer`,
        entry.scoreAfter
          ? `📊 After the over: *${entry.scoreAfter.runs}/${entry.scoreAfter.wickets}*`
          : null
      ],
      matchLabel: label,
      innings,
      matchInfo
    });

    await saveOverOutcome({
      matchId, innings, over: entry.over, battingTeam,
      runs: entry.runs, wickets: entry.wickets, status: 'NOTIFIED'
    });
  } catch (err) {
    logger.error(`Telegram send failed for tight-over wicket (match ${matchId} over ${entry.over}):`, err);
    await saveOverOutcome({
      matchId, innings, over: entry.over, battingTeam,
      runs: entry.runs, wickets: entry.wickets, status: 'SEND_FAILED'
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

  // The latest completed over, plus one over of slack so a missed tick or a
  // brief API outage does not lose an over outright.
  const pending = [];
  for (let over = Math.max(1, completedOvers - 1); over <= completedOvers; over++) {
    if (!(await isOverEvaluated(matchId, score.innings, over))) pending.push(over);
  }
  if (pending.length === 0) return;

  const stateKey = `${matchId}_${score.innings}`;
  if (processing.has(stateKey)) return;
  processing.add(stateKey);

  try {
    const forceFetch = completedOvers > (lastForcedOver.get(stateKey) || 0);
    if (forceFetch) lastForcedOver.set(stateKey, completedOvers);

    const result = await getOverHistory(matchId, { force: forceFetch });
    if (!result || result.history.length === 0) return;

    // Cross-check: the window must belong to a chase that is actually under way.
    if (!result.secondInningsStarted) {
      logger.warn(`Match ${matchId} — over history does not show a 2nd innings yet, skipping tight-over check.`);
      return;
    }

    const latestInWindow = Math.max(...result.history.map(o => o.over));

    for (const over of pending) {
      const entry = findOver(result.history, over);
      if (!entry) continue;                 // older than the rolling window
      if (latestInWindow <= over) continue; // no following over yet: not proven finished
      await judgeOver(matchId, score.innings, entry, match);
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
  for (const key of lastForcedOver.keys()) {
    if (!active.has(key.split('_')[0])) lastForcedOver.delete(key);
  }
}

module.exports = { handleTightOverWicket, pruneTightOverState };
