/**
 * strategies/secondOverWicket.js
 * Detects a wicket falling in the 2nd over and tracks trick outcome.
 *
 * Strategy: "2nd Over Wicket Trick"
 *   - Trigger: ANY new wicket falls during the 2nd over (overs 1.1 to 2.0)
 *     - Scenario A: First wicket falls in the 2nd over (0→1)
 *     - Scenario B: 1st wicket fell in the 1st over, another falls in the 2nd over (1→2)
 *   - Then wait for the next wicket:
 *     - If another wicket falls before 5th over completes (overs <= 5.0) → Done ✅
 *     - If 5th over completes (overs >= 5.0) with no further wicket → Fail ❌
 */

const {
  createSecondOverWicketTrick,
  getActiveSecondOverWicketTrick,
  resolveSecondOverWicketTrick,
  checkSecondOverWicketTrickExists
} = require('../db/secondOverWicketStore');
const { getActiveWicketTrick } = require('../db/wicketTrickStore');
const { sendSecondOverWicketAlert, sendTrickReply } = require('../services/telegram');
const { isMatchFinished } = require('../helpers/matchHelpers');
const { enrichedMatchLabel } = require('../helpers/matchFilter');
const { resolveTeamName } = require('../api/teamResolver');
const { SECOND_OVER_WICKET_MAX_OVERS } = require('../config');
const logger = require('../lib/logger');

// ── Detection ───────────────────────────────────────────
const processingDetection = new Set();

// Tracks previous wicket count per match/innings to detect when a wicket
// actually falls during the 2nd over vs. already having fallen earlier.
const prevWicketCountMap = new Map();

/**
 * Detects if a wicket falls in the 2nd over of any innings.
 * Covers two scenarios:
 *   A) First wicket falls in the 2nd over (0→1 transition)
 *   B) 1st wicket already fell in the 1st over, another falls in the 2nd over (1→2)
 * Uses overs (not ball count) to avoid counting wides, no-balls, etc.
 *
 * NOTE: If a first-over WicketTrick is already active for this match/innings,
 * the 2nd-over wicket trick is skipped to avoid duplicate notifications.
 */
async function detectSecondOverWicket(matchId, score, match) {
  const stateKey = `${matchId}_${score.innings}`;

  // Track wicket count transitions
  const prevWickets = prevWicketCountMap.get(stateKey) || 0;
  prevWicketCountMap.set(stateKey, score.wickets);

  // Only check during the 2nd over (overs 1.1 to 2.0)
  if (score.overs < 1.1 || score.overs > 2.0) return;

  // A new wicket must have JUST fallen in this poll (wicket count increased)
  if (score.wickets <= prevWickets) return;

  // Skip if a first-over WicketTrick is already tracking this match/innings.
  // That trick will produce its own "Done" notification for this wicket,
  // so sending a separate 2nd-over trick alert would be redundant.
  const activeFirstOverTrick = await getActiveWicketTrick(matchId, score.innings);
  if (activeFirstOverTrick) {
    logger.info(`⏭️ [2ND OVER WICKET] Skipping — active 1st-over WicketTrick exists for match ${matchId} innings ${score.innings}`);
    return;
  }

  // Check if we've already created a trick for this match/innings
  const exists = await checkSecondOverWicketTrickExists(matchId, score.innings);
  if (exists) return;

  const trickKey = `2ndov_${matchId}_${score.innings}`;
  if (processingDetection.has(trickKey)) return;

  processingDetection.add(trickKey);
  try {
    const { label, matchInfo } = await enrichedMatchLabel(matchId, match);
    const battingTeam = await resolveTeamName(score.battingTeamKey);

    logger.success(`🎯 [2ND OVER WICKET] Match ${label} Innings ${score.innings} — Wicket #${score.wickets} fell in 2nd over at ${score.overs} ov.`);

    const telegramMessageId = await sendSecondOverWicketAlert({
      matchLabel: label,
      innings: score.innings,
      battingTeam,
      runs: score.runs,
      wickets: score.wickets,
      overs: score.overs,
      matchInfo
    });

    if (telegramMessageId) {
      await createSecondOverWicketTrick({
        matchId,
        innings: score.innings,
        battingTeam,
        telegramMessageId,
        initialWickets: score.wickets,
        wicketBalls: score.balls
      });
      logger.success(`✅ [2ND OVER WICKET] Trick session created for ${label} Innings ${score.innings} (Msg ID: ${telegramMessageId})`);
    }
  } catch (err) {
    logger.error(`Error during 2nd Over Wicket Detection for match ${matchId}:`, err);
  } finally {
    processingDetection.delete(trickKey);
  }
}

// ── Trick Monitoring ────────────────────────────────────
const processingTrickCheck = new Set();

/**
 * Send a trick outcome reply and resolve the trick in DB.
 */
async function resolveTrick(matchId, score, activeTrick, status, reason) {
  const emoji = status === 'DONE' ? '✅ *DONE*' : `❌ *FAIL* — ${reason}`;
  const msg = `${emoji}\n*${activeTrick.battingTeam}*  ·  ${score.runs}/${score.wickets} (${score.overs} ov)`;
  await sendTrickReply(activeTrick.telegramMessageId, msg);
  await resolveSecondOverWicketTrick(matchId, score.innings, status);
}

/**
 * Monitors an active 2nd Over Wicket Trick session.
 * Uses overs (not ball count) for all comparisons.
 */
async function checkSecondOverWicketTrick(matchId, score, match) {
  const activeTrick = await getActiveSecondOverWicketTrick(matchId, score.innings);
  if (!activeTrick) return;

  const trickKey = `2ndov_chk_${matchId}_${score.innings}`;
  if (processingTrickCheck.has(trickKey)) return;

  const currentWickets = score.wickets;
  const initialWickets = activeTrick.initialWickets;
  const currentOvers = score.overs;
  const isFinished = isMatchFinished(match);

  // Determine outcome
  let status = null;
  let reason = null;

  if (currentWickets > initialWickets) {
    if (currentOvers <= SECOND_OVER_WICKET_MAX_OVERS) {
      status = 'DONE';
      logger.success(`🎯 [2ND OVER TRICK SUCCESS] Match ${matchId} innings ${score.innings} — Wickets: ${initialWickets} → ${currentWickets} at ${score.overs} ov.`);
    } else {
      status = 'FAIL';
      reason = 'Wicket fell after 5 overs';
      logger.info(`🚨 [2ND OVER TRICK FAIL] Match ${matchId} innings ${score.innings} — Wicket at ${score.overs} ov (after 5 overs limit).`);
    }
  } else if (currentOvers >= SECOND_OVER_WICKET_MAX_OVERS || isFinished) {
    status = 'FAIL';
    reason = isFinished ? 'Match finished' : '5 overs completed';
    logger.info(`🚨 [2ND OVER TRICK FAIL] Match ${matchId} innings ${score.innings} — ${reason} at ${score.overs} ov with no other wicket.`);
  }

  if (!status) return;

  processingTrickCheck.add(trickKey);
  try {
    await resolveTrick(matchId, score, activeTrick, status, reason);
  } catch (err) {
    logger.error(`Failed to resolve 2nd Over Wicket Trick (${status}) for match ${matchId}:`, err);
  } finally {
    processingTrickCheck.delete(trickKey);
  }
}

module.exports = { detectSecondOverWicket, checkSecondOverWicketTrick };
