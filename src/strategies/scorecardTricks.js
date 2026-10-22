/**
 * strategies/scorecardTricks.js
 * Tricks derived from the full match scorecard (captain / wicketkeeper / openers).
 *
 *   CAPTAIN_TOP_SCORER       T20        end of 1st innings — nobody out-scored the captain
 *   KEEPER_NOT_OUT           T20 + ODI  end of 1st innings — the keeper finished not out
 *   KEEPER_TOP_SCORER        T20 + ODI  end of 1st innings — nobody out-scored the keeper
 *   OPENER_HIGH_SR           ODI        1st innings — opener dismissed at 101+ SR (checked directly upon out)
 *   CAPTAIN_CHEAP_DISMISSAL  T20        either innings — captain out under 100 SR off 10+ balls
 *
 * All five alerts go to the dedicated trick channel.
 *
 * The scorecard endpoint is per-match, so it is only requested when a trick is
 * actually outstanding AND its cheap precondition (wickets on the board, innings
 * complete) already holds. api/scorecard.js then caches each response, which
 * keeps this to a handful of requests per match rather than one per poll.
 */

const { getScorecard } = require('../api/scorecard');
const { resolvePlayerNames } = require('../api/playerResolver');
const { resolveTeamName } = require('../api/teamResolver');
const { findInnings } = require('../helpers/scorecardParser');
const { parseScore } = require('../helpers/scoreParser');
const rules = require('../helpers/scorecardTrickRules');
const { isT20Match, isODIMatch, isMatchFinished } = require('../helpers/matchHelpers');
const { enrichedMatchLabel } = require('../helpers/matchFilter');
const { isTrickSettled, saveTrickOutcome } = require('../db/scorecardTrickStore');
const { sendScorecardTrickAlert, escapeMarkdown } = require('../services/telegram');
const { OPENER_HIGH_SR_MIN, CAPTAIN_CHEAP_MAX_SR, CAPTAIN_CHEAP_MIN_BALLS } = require('../config');
const logger = require('../lib/logger');

const processing = new Set();

/** Render "87 (42)". */
const fig = (b) => `*${b.runs}* (${b.balls})`;
/** Render a strike rate to two places. */
const sr = (b) => b.strikeRate.toFixed(2);

// ── Trick definitions ───────────────────────────────────
// scope: 'FIRST_INNINGS_END' → evaluated once, against innings 1, after it ends
//        'CURRENT'           → evaluated against the innings being bowled
const TRICKS = [
  {
    id: 'CAPTAIN_TOP_SCORER',
    scope: 'FIRST_INNINGS_END',
    formats: { t20: true, odi: false },
    rule: rules.captainTopScorer,
    keysOf: (r) => [r.player.key, r.topOtherBatter && r.topOtherBatter.key],
    build: (r, names, team) => ({
      title: `👑 *CAPTAIN TOP SCORER*`,
      headline: `*${escapeMarkdown(names[r.player.key])}* (C) top-scored with ${fig(r.player)}`,
      detailLines: [
        r.tied
          ? `⚡ Joint-highest score of the innings`
          : `⚡ No other ${team} batter passed the captain`,
        r.topOtherBatter
          ? `📊 Next best: ${escapeMarkdown(names[r.topOtherBatter.key])} ${r.topOtherBatter.runs} (${r.topOtherBatter.balls})`
          : null,
        `🧮 Captain SR ${sr(r.player)}`
      ]
    })
  },
  {
    id: 'KEEPER_NOT_OUT',
    scope: 'FIRST_INNINGS_END',
    formats: { t20: true, odi: true },
    rule: rules.keeperNotOut,
    keysOf: (r) => [r.player.key],
    build: (r, names) => ({
      title: `🧤 *KEEPER NOT OUT — 1ST INN*`,
      headline: `*${escapeMarkdown(names[r.player.key])}* (WK) finished ${fig(r.player)} not out`,
      detailLines: [
        `⚡ Unbeaten at the end of the 1st innings`,
        `🧮 SR ${sr(r.player)}  ·  ${r.player.fours}x4  ${r.player.sixes}x6`
      ]
    })
  },
  {
    id: 'KEEPER_TOP_SCORER',
    scope: 'FIRST_INNINGS_END',
    formats: { t20: true, odi: true },
    rule: rules.keeperTopScorer,
    keysOf: (r) => [r.player.key, r.topOtherBatter && r.topOtherBatter.key],
    build: (r, names, team) => ({
      title: `🧤 *KEEPER TOP SCORER*`,
      headline: `*${escapeMarkdown(names[r.player.key])}* (WK) top-scored with ${fig(r.player)}`,
      detailLines: [
        r.tied
          ? `⚡ Joint-highest score of the innings`
          : `⚡ No other ${team} batter passed the keeper`,
        r.topOtherBatter
          ? `📊 Next best: ${escapeMarkdown(names[r.topOtherBatter.key])} ${r.topOtherBatter.runs} (${r.topOtherBatter.balls})`
          : null,
        `🧮 Keeper SR ${sr(r.player)}`
      ]
    })
  },
  {
    id: 'OPENER_1_HIGH_SR',
    scope: 'CURRENT',
    firstInningsOnly: true,
    formats: { t20: false, odi: true },
    minWickets: 1,
    rule: (innings) => rules.openerHighStrikeRate(innings, 0),
    keysOf: (r) => [r.player.key],
    build: (r, names) => ({
      title: `⚡ *OPENER OUT — HIGH SR (1ST INN)*`,
      headline: `*${escapeMarkdown(names[r.player.key])}* (Opener) out for ${fig(r.player)}  ·  SR *${sr(r.player)}*`,
      detailLines: [
        `⚡ Dismissed at SR ${OPENER_HIGH_SR_MIN - 1}+ in the 1st innings`,
        `🧮 ${r.player.balls} balls faced  ·  ${r.player.fours}x4  ${r.player.sixes}x6`
      ]
    })
  },
  {
    id: 'OPENER_2_HIGH_SR',
    scope: 'CURRENT',
    firstInningsOnly: true,
    formats: { t20: false, odi: true },
    minWickets: 1,
    rule: (innings) => rules.openerHighStrikeRate(innings, 1),
    keysOf: (r) => [r.player.key],
    build: (r, names) => ({
      title: `⚡ *OPENER OUT — HIGH SR (1ST INN)*`,
      headline: `*${escapeMarkdown(names[r.player.key])}* (Opener) out for ${fig(r.player)}  ·  SR *${sr(r.player)}*`,
      detailLines: [
        `⚡ Dismissed at SR ${OPENER_HIGH_SR_MIN - 1}+ in the 1st innings`,
        `🧮 ${r.player.balls} balls faced  ·  ${r.player.fours}x4  ${r.player.sixes}x6`
      ]
    })
  },
  {
    id: 'CAPTAIN_CHEAP_DISMISSAL',
    scope: 'CURRENT',
    formats: { t20: true, odi: false },
    minWickets: 1,
    rule: rules.captainCheapDismissal,
    keysOf: (r) => [r.player.key],
    build: (r, names) => ({
      title: `🐌 *CAPTAIN OUT — SLOW*`,
      headline: `*${escapeMarkdown(names[r.player.key])}* (C) out for ${fig(r.player)}  ·  SR *${sr(r.player)}*`,
      detailLines: [
        `⚡ Under ${CAPTAIN_CHEAP_MAX_SR} SR off ${CAPTAIN_CHEAP_MIN_BALLS}+ balls`,
        `🧮 ${r.player.balls} balls faced  ·  ${r.player.fours}x4  ${r.player.sixes}x6`
      ]
    })
  }
];

/**
 * Which tricks could still produce an alert for this match right now?
 * Returns [{ trick, innings }] after the cheap preconditions and the
 * once-only bookkeeping, so an empty list means no scorecard request.
 */
async function outstandingTricks(matchId, score, match) {
  const t20 = isT20Match(match);
  const odi = isODIMatch(match);
  if (!t20 && !odi) return [];

  const firstInningsComplete = score.innings === 2;
  const candidates = [];

  for (const trick of TRICKS) {
    if (!(t20 ? trick.formats.t20 : trick.formats.odi)) continue;

    if (trick.firstInningsOnly && score.innings !== 1) continue;

    if (trick.scope === 'FIRST_INNINGS_END') {
      if (!firstInningsComplete) continue;
      candidates.push({ trick, innings: 1 });
      continue;
    }

    // 'CURRENT' — needs enough wickets down for the rule to be decidable.
    if (trick.minWickets && score.wickets < trick.minWickets) continue;
    // A first-innings-only trick always targets innings 1, never whichever
    // innings happens to be live. The guard above already requires
    // score.innings === 1; naming it here keeps the two from drifting apart.
    candidates.push({ trick, innings: trick.firstInningsOnly ? 1 : score.innings });
  }

  const outstanding = [];
  for (const candidate of candidates) {
    const settled = await isTrickSettled(matchId, candidate.innings, candidate.trick.id);
    if (!settled) outstanding.push(candidate);
  }
  return outstanding;
}

/**
 * Sanity-check the scorecard's innings ordering against the live feed.
 * Once the 1st innings is complete the feed's `j` field is frozen, so the
 * scorecard's first innings must agree with it. If they disagree, the
 * scorecard is not ordered the way we assume and we must not report a
 * "1st innings" trick against the wrong team.
 */
function firstInningsAgreesWithFeed(scorecard, match) {
  // With a single innings on the card there is nothing to mis-order: entry 0
  // is the innings being bowled. Checking scores here would also fight the
  // scorecard cache, which can briefly lag the live feed mid-innings.
  if (scorecard.length < 2) return true;

  // Both innings exist, so the 1st innings is frozen and `j` must agree.
  const feedFirst = parseScore(match.j);
  if (!feedFirst || !scorecard[0]) return true;
  return scorecard[0].runs === feedFirst.runs
    && scorecard[0].wickets === feedFirst.wickets;
}

/**
 * Evaluate one trick and, when it qualifies, alert and record the outcome.
 */
async function evaluateTrick({ trick, innings: inningsNo }, matchId, scorecard, context) {
  const innings = findInnings(scorecard, inningsNo)
    || (inningsNo === 1 ? scorecard[0] : null);

  if (!innings) {
    logger.info(`📋 [${trick.id}] Match ${matchId} — innings ${inningsNo} not on the scorecard yet.`);
    return;
  }

  const result = trick.rule(innings);
  if (!result.evaluable) {
    logger.info(`📋 [${trick.id}] Match ${matchId} innings ${inningsNo} — not decidable yet (${result.reason}).`);
    return;
  }

  const battingTeam = await resolveTeamName(innings.battingTeamKey);

  if (!result.qualifies) {
    logger.info(`📋 [${trick.id} SKIPPED] Match ${matchId} innings ${inningsNo} — criteria not met.`);
    await saveTrickOutcome({
      matchId, innings: inningsNo, trick: trick.id,
      battingTeam, status: 'SKIPPED'
    });
    return;
  }

  const names = await resolvePlayerNames(trick.keysOf(result).filter(Boolean));
  const { label, matchInfo } = context;
  const { title, headline, detailLines } = trick.build(result, names, battingTeam);

  const primaryKey = trick.keysOf(result).filter(Boolean)[0];
  const playerName = names[primaryKey] || primaryKey;
  const summary = `${playerName} — ${label} innings ${inningsNo}`;

  logger.success(`📋 [${trick.id}] Match ${label} innings ${inningsNo} — ${playerName}. ALERT!`);

  try {
    await sendScorecardTrickAlert({
      title, headline, detailLines,
      matchLabel: label,
      innings: inningsNo,
      matchInfo
    });

    await saveTrickOutcome({
      matchId, innings: inningsNo, trick: trick.id,
      battingTeam, playerName, summary, status: 'NOTIFIED'
    });
  } catch (err) {
    logger.error(`Telegram send failed for ${trick.id} (match ${matchId}):`, err);
    // Recorded as a failed attempt so it retries, but only a bounded number of times.
    await saveTrickOutcome({
      matchId, innings: inningsNo, trick: trick.id,
      battingTeam, playerName, summary, status: 'SEND_FAILED'
    });
  }
}

/**
 * Entry point — called once per live match per poll tick.
 */
async function handleScorecardTricks(matchId, score, match) {
  // A finished match lingers in the live feed. These tricks test a lasting
  // state rather than a moment, so without this guard every completed match
  // still in the feed would alert again on the next process start.
  if (isMatchFinished(match)) return;

  let outstanding = await outstandingTricks(matchId, score, match);
  if (outstanding.length === 0) return;

  if (processing.has(matchId)) return;
  processing.add(matchId);

  try {
    const scorecard = await getScorecard(matchId);
    if (!scorecard) return;

    if (!firstInningsAgreesWithFeed(scorecard, match)) {
      logger.warn(
        `Scorecard for match ${matchId} disagrees with the live feed on the 1st innings ` +
        `(scorecard ${scorecard[0].runs}/${scorecard[0].wickets}, feed ${match.j}) — ` +
        `skipping every 1st-innings trick.`
      );
      outstanding = outstanding.filter(c => c.innings !== 1);
      if (outstanding.length === 0) return;
    }

    // Resolved once per tick and shared by every trick, rather than per alert.
    const context = await enrichedMatchLabel(matchId, match);

    for (const candidate of outstanding) {
      try {
        await evaluateTrick(candidate, matchId, scorecard, context);
      } catch (err) {
        logger.error(`Error evaluating ${candidate.trick.id} for match ${matchId}:`, err);
      }
    }
  } finally {
    processing.delete(matchId);
  }
}

module.exports = { handleScorecardTricks, TRICKS };
