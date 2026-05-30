/**
 * db/overRunsTrickStore.js
 * CRUD operations for OverRunsTrick evaluations with in-memory fallback.
 */

const { isDbConnected } = require('./connection');
const OverRunsTrick = require('./models/OverRunsTrick');
const logger = require('../lib/logger');

const fallbackMap = new Map();

async function checkOverRunsTrickEvaluated(matchId, innings) {
  if (isDbConnected()) {
    try {
      const existing = await OverRunsTrick.findOne({ matchId, innings });
      return !!existing;
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to check OverRunsTrick:', err);
      return false;
    }
  }
  return fallbackMap.has(`${matchId}_${innings}`);
}

async function saveOverRunsTrickEvaluation({ matchId, innings, battingTeam, runsAtFirstOver, ballsAtEvaluation, notified, status }) {
  const data = { matchId, innings, battingTeam, runsAtFirstOver, ballsAtEvaluation, notified, status };

  if (isDbConnected()) {
    try {
      await OverRunsTrick.findOneAndUpdate(
        { matchId, innings },
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      logger.info(`💾 [DB] Evaluated OverRunsTrick for match ${matchId} Innings ${innings} (Runs: ${runsAtFirstOver}, Status: ${status})`);
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to save OverRunsTrick:', err);
    }
  } else {
    fallbackMap.set(`${matchId}_${innings}`, data);
    logger.info(`💾 [InMemory] Evaluated OverRunsTrick for match ${matchId} Innings ${innings} (Runs: ${runsAtFirstOver}, Status: ${status})`);
  }
}

module.exports = { checkOverRunsTrickEvaluated, saveOverRunsTrickEvaluation };
