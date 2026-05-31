/**
 * strategies/deathOversWicket.js
 * Detects and alerts when a T20 2nd innings has exactly 4 wickets down
 * after completing 16 overs (overs >= 16.0).
 *
 * Strategy: "Death Overs Wicket Trick"
 *   - Match format: T20 only
 *   - Innings:      2nd innings only
 *   - Trigger:      overs >= 16.0 AND exactly 4 wickets down
 *   - One-shot:     evaluated once per match, then stored as NOTIFIED / SKIPPED
 */

const { checkDeathOversWicketEvaluated, saveDeathOversWicketEvaluation } = require('../db/deathOversWicketStore');
const { sendDeathOversWicketAlert } = require('../services/telegram');
const { isT20Match } = require('../helpers/matchHelpers');
const { matchLabel } = require('../helpers/matchFilter');
const { resolveTeamName } = require('../api/teamResolver');
const { parseScore } = require('../helpers/scoreParser');
const { DEATH_OVERS_WICKET_MIN_OVERS, DEATH_OVERS_WICKET_EXACT_WICKETS } = require('../config');
const logger = require('../lib/logger');

const processingDeathOvers = new Set();

/**
 * Checks and handles the Death Overs Wicket trick for T20 2nd innings.
 */
async function handleDeathOversWicketTrick(matchId, score, match) {
  // Rule only applies to T20 matches
  if (!isT20Match(match)) return;

  // Only applies to 2nd innings
  if (score.innings !== 2) return;

  // Must have completed 16 overs (overs >= 16.0)
  if (score.overs < DEATH_OVERS_WICKET_MIN_OVERS) return;

  // Already evaluated for this match?
  const evaluated = await checkDeathOversWicketEvaluated(matchId, score.innings);
  if (evaluated) return;

  const trickKey = `deathov_${matchId}_${score.innings}`;
  if (processingDeathOvers.has(trickKey)) return;

  processingDeathOvers.add(trickKey);
  try {
    const label = await matchLabel(matchId, match);
    const battingTeam = await resolveTeamName(score.battingTeamKey);

    // Parse 1st innings score to include as context (target info)
    const firstInningsScore = parseScore(match.j);

    if (score.wickets === DEATH_OVERS_WICKET_EXACT_WICKETS) {
      logger.success(
        `⚡ [DEATH OVERS WICKET TRICK] Match ${label} — 2nd Innings ${battingTeam}: ` +
        `${score.runs}/${score.wickets} at ${score.overs} ov — Exactly ${DEATH_OVERS_WICKET_EXACT_WICKETS} wickets down after 16 overs. ALERT!`
      );

      await sendDeathOversWicketAlert({
        matchLabel: label,
        battingTeam,
        runs: score.runs,
        wickets: score.wickets,
        overs: score.overs,
        target: firstInningsScore ? firstInningsScore.runs + 1 : null,
        firstInningsRuns: firstInningsScore ? firstInningsScore.runs : null,
        firstInningsWickets: firstInningsScore ? firstInningsScore.wickets : null
      });

      await saveDeathOversWicketEvaluation({
        matchId, innings: score.innings, battingTeam,
        runs: score.runs, wickets: score.wickets, overs: score.overs,
        notified: true, status: 'NOTIFIED'
      });
    } else {
      logger.info(
        `⚡ [DEATH OVERS WICKET SKIPPED] Match ${label} — 2nd Innings ${battingTeam}: ` +
        `${score.runs}/${score.wickets} at ${score.overs} ov — ` +
        `${score.wickets} wickets (need exactly ${DEATH_OVERS_WICKET_EXACT_WICKETS}). Skipping.`
      );

      await saveDeathOversWicketEvaluation({
        matchId, innings: score.innings, battingTeam,
        runs: score.runs, wickets: score.wickets, overs: score.overs,
        notified: false, status: 'SKIPPED'
      });
    }
  } catch (err) {
    logger.error(`❌ Error during Death Overs Wicket Trick evaluation for match ${matchId}:`, err);
  } finally {
    processingDeathOvers.delete(trickKey);
  }
}

module.exports = { handleDeathOversWicketTrick };
