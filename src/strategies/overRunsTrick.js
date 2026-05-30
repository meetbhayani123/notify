/**
 * strategies/overRunsTrick.js
 * Evaluates the 1st Over Runs trick for T20 matches.
 * Triggers alert if first-over runs meet the threshold (1st inn: >=14, 2nd inn: >=13).
 */

const { getFirstOverRuns } = require('../db/sessionStore');
const { checkOverRunsTrickEvaluated, saveOverRunsTrickEvaluation } = require('../db/overRunsTrickStore');
const { sendTrickNotifyAlert } = require('../services/telegram');
const { isT20Match } = require('../helpers/matchHelpers');
const { matchLabel } = require('../helpers/matchFilter');
const { resolveTeamName } = require('../api/teamResolver');
const { FIRST_OVER_RUNS_THRESHOLD } = require('../config');
const logger = require('../lib/logger');

const processingOverRuns = new Set();

/**
 * Checks and handles the 1st Over Runs trick for T20 matches.
 */
async function handleOverRunsTrick(matchId, score, match) {
  // Rule only applies to T20 matches
  if (!isT20Match(match)) return;

  // Must have completed the first over (balls >= 6)
  if (score.balls < 6) return;

  // Ensure we haven't already evaluated this match/innings
  const evaluated = await checkOverRunsTrickEvaluated(matchId, score.innings);
  if (evaluated) return;

  const trickKey = `${matchId}_${score.innings}`;
  if (processingOverRuns.has(trickKey)) return;

  processingOverRuns.add(trickKey);
  try {
    const runsAtFirstOver = await getFirstOverRuns(matchId, score.innings, score);
    const label = await matchLabel(matchId, match);
    const battingTeam = await resolveTeamName(score.battingTeamKey);

    if (runsAtFirstOver === null || runsAtFirstOver === undefined) {
      logger.info(`📊 [OVER RUNS TRICK SKIPPED] Match ${label} Innings ${score.innings} — No first over history captured. Skipping.`);
      await saveOverRunsTrickEvaluation({
        matchId, innings: score.innings, battingTeam,
        runsAtFirstOver: null, ballsAtEvaluation: score.balls,
        notified: false, status: 'SKIPPED'
      });
      return;
    }

    const threshold = FIRST_OVER_RUNS_THRESHOLD[score.innings] || 14;
    const isTargetMet = runsAtFirstOver >= threshold;

    if (isTargetMet) {
      logger.success(`📊 [OVER RUNS TRICK SUCCESS] Match ${label} Innings ${score.innings} — ${runsAtFirstOver} runs (Threshold: >= ${threshold}). Sending Alert.`);
      await sendTrickNotifyAlert({ matchLabel: label, innings: score.innings, battingTeam, runs: runsAtFirstOver, threshold });
      await saveOverRunsTrickEvaluation({
        matchId, innings: score.innings, battingTeam,
        runsAtFirstOver, ballsAtEvaluation: score.balls,
        notified: true, status: 'NOTIFIED'
      });
    } else {
      logger.info(`📊 [OVER RUNS TRICK SKIPPED] Match ${label} Innings ${score.innings} — ${runsAtFirstOver} runs (Threshold: >= ${threshold}). Did not meet criteria.`);
      await saveOverRunsTrickEvaluation({
        matchId, innings: score.innings, battingTeam,
        runsAtFirstOver, ballsAtEvaluation: score.balls,
        notified: false, status: 'SKIPPED'
      });
    }
  } catch (err) {
    logger.error(`❌ Error during Over Runs Trick evaluation for match ${matchId}:`, err);
  } finally {
    processingOverRuns.delete(trickKey);
  }
}

module.exports = { handleOverRunsTrick };
