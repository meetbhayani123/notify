/**
 * strategies/wicketTrick.js
 * Monitors active WicketTrick sessions for Done/Fail outcomes.
 * Checks if another wicket falls within 4 overs (24 balls) after the first-over wicket.
 */

const { getActiveWicketTrick, resolveWicketTrick } = require('../db/wicketTrickStore');
const { sendTelegramReply } = require('../services/telegram');
const { isMatchFinished } = require('../helpers/matchHelpers');
const { WICKET_TRICK_MAX_BALLS } = require('../config');
const logger = require('../lib/logger');

const processingTricks = new Set();

/**
 * Send a trick outcome reply and resolve the trick in DB.
 */
async function resolveTrick(matchId, score, activeTrick, status, reason) {
  const emoji = status === 'DONE' ? 'Done ✅' : `Fail ❌ (${reason})`;
  const msg = `${emoji}\n*${activeTrick.battingTeam}*: ${score.runs}/${score.wickets} (${score.overs} ov)`;
  await sendTelegramReply(activeTrick.telegramMessageId, msg);
  await resolveWicketTrick(matchId, score.innings, status);
}

/**
 * Checks and handles the Wicket Trick logic for active sessions.
 */
async function handleWicketTrickCheck(matchId, score, match) {
  const activeTrick = await getActiveWicketTrick(matchId, score.innings);
  if (!activeTrick) return;

  const trickKey = `${matchId}_${score.innings}`;
  if (processingTricks.has(trickKey)) return;

  const currentWickets = score.wickets;
  const initialWickets = activeTrick.initialWickets;
  const currentBalls = score.balls;
  const isFinished = isMatchFinished(match);

  // Determine outcome
  let status = null;
  let reason = null;

  if (currentWickets > initialWickets) {
    if (currentBalls <= WICKET_TRICK_MAX_BALLS) {
      status = 'DONE';
      reason = null;
      logger.success(`🎯 [TRICK SUCCESS] Match ${matchId} innings ${score.innings} — Wickets: ${initialWickets} → ${currentWickets} in ${score.overs} ov.`);
    } else {
      status = 'FAIL';
      reason = 'Wicket fell after 4 overs';
      logger.info(`🚨 [TRICK FAIL] Match ${matchId} innings ${score.innings} — Wicket at ${score.overs} ov (after 4 overs limit).`);
    }
  } else if (currentBalls >= WICKET_TRICK_MAX_BALLS || isFinished) {
    status = 'FAIL';
    reason = isFinished ? 'Match finished' : '4 overs completed';
    logger.info(`🚨 [TRICK FAIL] Match ${matchId} innings ${score.innings} — ${reason} at ${score.overs} ov with no other wicket.`);
  }

  if (!status) return;

  processingTricks.add(trickKey);
  try {
    await resolveTrick(matchId, score, activeTrick, status, reason);
  } catch (err) {
    logger.error(`Failed to resolve Wicket Trick (${status}) for match ${matchId}:`, err);
  } finally {
    processingTricks.delete(trickKey);
  }
}

module.exports = { handleWicketTrickCheck };
