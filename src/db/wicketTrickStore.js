/**
 * db/wicketTrickStore.js
 * CRUD operations for WicketTrick sessions with in-memory fallback.
 */

const { isDbConnected } = require('./connection');
const WicketTrick = require('./models/WicketTrick');
const logger = require('../lib/logger');

const fallbackMap = new Map();

async function createWicketTrick({ matchId, innings, battingTeam, telegramMessageId, initialWickets }) {
  const data = {
    matchId, innings, battingTeam, telegramMessageId, initialWickets,
    status: 'PENDING', resolved: false
  };

  if (isDbConnected()) {
    try {
      await WicketTrick.findOneAndUpdate(
        { matchId, innings },
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      logger.info(`💾 [DB] Created WicketTrick for match ${matchId} Innings ${innings}`);
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to create WicketTrick:', err);
    }
  } else {
    fallbackMap.set(`${matchId}_${innings}`, data);
    logger.info(`💾 [InMemory] Created WicketTrick for match ${matchId} Innings ${innings}`);
  }
}

async function getActiveWicketTrick(matchId, innings) {
  if (isDbConnected()) {
    try {
      return await WicketTrick.findOne({ matchId, innings, resolved: false });
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to get active WicketTrick:', err);
      return null;
    }
  }
  const trick = fallbackMap.get(`${matchId}_${innings}`);
  return (trick && !trick.resolved) ? trick : null;
}

async function resolveWicketTrick(matchId, innings, status) {
  const update = { status, resolved: true, completedAt: new Date() };

  if (isDbConnected()) {
    try {
      await WicketTrick.updateOne({ matchId, innings }, { $set: update });
      logger.info(`💾 [DB] Resolved WicketTrick for match ${matchId} Innings ${innings} as ${status}`);
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to resolve WicketTrick:', err);
    }
  } else {
    const key = `${matchId}_${innings}`;
    const existing = fallbackMap.get(key);
    if (existing) {
      Object.assign(existing, update);
      fallbackMap.set(key, existing);
      logger.info(`💾 [InMemory] Resolved WicketTrick for match ${matchId} Innings ${innings} as ${status}`);
    }
  }
}

async function sweepOrphanedTricks(activeMatchIds, sendTelegramReplyFn) {
  if (!isDbConnected()) {
    for (const [key, trick] of fallbackMap.entries()) {
      if (!trick.resolved && !activeMatchIds.includes(trick.matchId)) {
        logger.info(`🧹 [InMemory SWEEP] Found orphaned pending trick for match ${trick.matchId} (innings ${trick.innings}). Marking as FAIL.`);
        try {
          if (sendTelegramReplyFn) await sendTelegramReplyFn(trick.telegramMessageId, 'Fail ❌');
        } catch (err) {
          logger.error('[SWEEP ERROR] Failed to reply to orphaned trick:', err);
        }
        trick.status = 'FAIL';
        trick.resolved = true;
        trick.completedAt = new Date();
        fallbackMap.set(key, trick);
      }
    }
    return;
  }

  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const orphanedTricks = await WicketTrick.find({
      resolved: false,
      matchId: { $nin: activeMatchIds },
      createdAt: { $lt: tenMinutesAgo }
    });

    for (const trick of orphanedTricks) {
      logger.info(`🧹 [DB SWEEP] Found orphaned pending trick for match ${trick.matchId} (innings ${trick.innings}). Marking as FAIL.`);
      try {
        if (sendTelegramReplyFn) await sendTelegramReplyFn(trick.telegramMessageId, 'Fail ❌');
      } catch (err) {
        logger.error(`[SWEEP ERROR] Failed to send Telegram reply during sweep for match ${trick.matchId}:`, err);
      }
      await resolveWicketTrick(trick.matchId, trick.innings, 'FAIL');
    }
  } catch (err) {
    logger.error('💾 [DB ERROR] Failed during orphaned tricks sweep:', err);
  }
}

module.exports = { createWicketTrick, getActiveWicketTrick, resolveWicketTrick, sweepOrphanedTricks };
