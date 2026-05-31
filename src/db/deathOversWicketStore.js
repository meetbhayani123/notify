/**
 * db/deathOversWicketStore.js
 * CRUD operations for DeathOversWicketTrick evaluations with in-memory fallback.
 */

const { isDbConnected } = require('./connection');
const DeathOversWicketTrick = require('./models/DeathOversWicketTrick');
const logger = require('../lib/logger');

const fallbackMap = new Map();

async function checkDeathOversWicketEvaluated(matchId, innings) {
  if (isDbConnected()) {
    try {
      const existing = await DeathOversWicketTrick.findOne({ matchId, innings });
      return !!existing;
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to check DeathOversWicketTrick:', err);
      return false;
    }
  }
  return fallbackMap.has(`${matchId}_${innings}`);
}

async function saveDeathOversWicketEvaluation({ matchId, innings, battingTeam, runs, wickets, overs, notified, status }) {
  const data = { matchId, innings, battingTeam, runs, wickets, overs, notified, status };

  if (isDbConnected()) {
    try {
      await DeathOversWicketTrick.findOneAndUpdate(
        { matchId, innings },
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      logger.info(`💾 [DB] Evaluated DeathOversWicketTrick for match ${matchId} Innings ${innings} (${runs}/${wickets} at ${overs} ov, Status: ${status})`);
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to save DeathOversWicketTrick:', err);
    }
  } else {
    fallbackMap.set(`${matchId}_${innings}`, data);
    logger.info(`💾 [InMemory] Evaluated DeathOversWicketTrick for match ${matchId} Innings ${innings} (${runs}/${wickets} at ${overs} ov, Status: ${status})`);
  }
}

module.exports = { checkDeathOversWicketEvaluated, saveDeathOversWicketEvaluation };
