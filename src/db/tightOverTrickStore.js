/**
 * db/tightOverTrickStore.js
 * Once-per-over bookkeeping for the tight-over wicket trick, with in-memory
 * fallback. Unlike the scorecard tricks this one can fire several times in an
 * innings, so the unit of deduplication is (matchId, innings, over).
 */

const { isDbConnected } = require('./connection');
const TightOverTrick = require('./models/TightOverTrick');
const logger = require('../lib/logger');

const fallbackMap = new Map();
const evaluatedKeys = new Set();

const keyOf = (matchId, innings, over) => `${matchId}_${innings}_${over}`;

/**
 * Has this over already been judged for this match and innings?
 */
async function isOverEvaluated(matchId, innings, over) {
  const key = keyOf(matchId, innings, over);
  if (evaluatedKeys.has(key)) return true;

  if (isDbConnected()) {
    try {
      const existing = await TightOverTrick.findOne({ matchId, innings, over }).lean();
      if (existing) {
        evaluatedKeys.add(key);
        return true;
      }
      return false;
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to check TightOverTrick:', err);
      // Fail closed rather than risk a duplicate alert.
      return true;
    }
  }

  return fallbackMap.has(key);
}

/**
 * Record the outcome of judging one over.
 *
 * @param {'NOTIFIED'|'SKIPPED'|'SEND_FAILED'} outcome.status
 */
async function saveOverOutcome({ matchId, innings, over, battingTeam, runs, wickets, status }) {
  const key = keyOf(matchId, innings, over);
  const data = {
    matchId, innings, over, battingTeam, runs, wickets,
    status, notified: status === 'NOTIFIED'
  };

  // A failed send is not recorded as evaluated, so the next tick retries it.
  if (status !== 'SEND_FAILED') evaluatedKeys.add(key);

  if (isDbConnected()) {
    try {
      if (status === 'SEND_FAILED') return;
      await TightOverTrick.findOneAndUpdate(
        { matchId, innings, over },
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      logger.info(`💾 [DB] TightOverTrick match ${matchId} innings ${innings} over ${over} → ${status}`);
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to save TightOverTrick:', err);
    }
    return;
  }

  if (status === 'SEND_FAILED') return;
  fallbackMap.set(key, data);
  logger.info(`💾 [InMemory] TightOverTrick match ${matchId} innings ${innings} over ${over} → ${status}`);
}

/**
 * Forget in-memory state for matches that are no longer live.
 */
function pruneTightOverKeys(activeMatchIds) {
  const active = new Set(activeMatchIds);
  for (const key of evaluatedKeys) {
    if (!active.has(key.split('_')[0])) evaluatedKeys.delete(key);
  }
  for (const key of fallbackMap.keys()) {
    if (!active.has(key.split('_')[0])) fallbackMap.delete(key);
  }
}

module.exports = { isOverEvaluated, saveOverOutcome, pruneTightOverKeys };
