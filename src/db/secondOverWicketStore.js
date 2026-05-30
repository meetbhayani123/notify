/**
 * db/secondOverWicketStore.js
 * CRUD operations for SecondOverWicketTrick sessions with in-memory fallback.
 */

const { isDbConnected } = require('./connection');
const SecondOverWicketTrick = require('./models/SecondOverWicketTrick');
const logger = require('../lib/logger');

const fallbackMap = new Map();

async function createSecondOverWicketTrick({ matchId, innings, battingTeam, telegramMessageId, initialWickets, wicketBalls }) {
  const data = {
    matchId, innings, battingTeam, telegramMessageId, initialWickets, wicketBalls,
    status: 'PENDING', resolved: false
  };

  if (isDbConnected()) {
    try {
      await SecondOverWicketTrick.findOneAndUpdate(
        { matchId, innings },
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      logger.info(`💾 [DB] Created SecondOverWicketTrick for match ${matchId} Innings ${innings}`);
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to create SecondOverWicketTrick:', err);
    }
  } else {
    fallbackMap.set(`${matchId}_${innings}`, data);
    logger.info(`💾 [InMemory] Created SecondOverWicketTrick for match ${matchId} Innings ${innings}`);
  }
}

async function getActiveSecondOverWicketTrick(matchId, innings) {
  if (isDbConnected()) {
    try {
      return await SecondOverWicketTrick.findOne({ matchId, innings, resolved: false });
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to get active SecondOverWicketTrick:', err);
      return null;
    }
  }
  const trick = fallbackMap.get(`${matchId}_${innings}`);
  return (trick && !trick.resolved) ? trick : null;
}

async function resolveSecondOverWicketTrick(matchId, innings, status) {
  const update = { status, resolved: true, completedAt: new Date() };

  if (isDbConnected()) {
    try {
      await SecondOverWicketTrick.updateOne({ matchId, innings }, { $set: update });
      logger.info(`💾 [DB] Resolved SecondOverWicketTrick for match ${matchId} Innings ${innings} as ${status}`);
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to resolve SecondOverWicketTrick:', err);
    }
  } else {
    const key = `${matchId}_${innings}`;
    const existing = fallbackMap.get(key);
    if (existing) {
      Object.assign(existing, update);
      fallbackMap.set(key, existing);
      logger.info(`💾 [InMemory] Resolved SecondOverWicketTrick for match ${matchId} Innings ${innings} as ${status}`);
    }
  }
}

async function checkSecondOverWicketTrickExists(matchId, innings) {
  if (isDbConnected()) {
    try {
      const existing = await SecondOverWicketTrick.findOne({ matchId, innings });
      return !!existing;
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to check SecondOverWicketTrick:', err);
      return false;
    }
  }
  return fallbackMap.has(`${matchId}_${innings}`);
}

module.exports = {
  createSecondOverWicketTrick,
  getActiveSecondOverWicketTrick,
  resolveSecondOverWicketTrick,
  checkSecondOverWicketTrickExists
};
