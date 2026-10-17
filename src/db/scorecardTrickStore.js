/**
 * db/scorecardTrickStore.js
 * Once-only bookkeeping for the scorecard-derived tricks, with in-memory fallback.
 *
 * Each (matchId, innings, trick) is evaluated once. A trick is "settled" when it
 * has been notified, deliberately skipped, or has exhausted its send attempts —
 * settled tricks are remembered in memory too, so a settled trick costs no
 * further database reads on later polls.
 */

const { isDbConnected } = require('./connection');
const ScorecardTrick = require('./models/ScorecardTrick');
const logger = require('../lib/logger');

const MAX_SEND_ATTEMPTS = 3;

const fallbackMap = new Map();
// Fast path: keys known to need no further work.
const settledKeys = new Set();
// A trick that is still outstanding is re-checked at most this often, so an
// undecided trick (a captain still batting, say) costs one read every few
// seconds rather than one on every poll tick.
const recheckAfter = new Map();
const UNSETTLED_TTL_MS = 10_000;

const keyOf = (matchId, innings, trick) => `${matchId}_${innings}_${trick}`;

function isTerminal(record) {
  if (!record) return false;
  if (record.status === 'NOTIFIED' || record.status === 'SKIPPED') return true;
  return (record.attempts || 0) >= MAX_SEND_ATTEMPTS;
}

/**
 * Has this trick already been dealt with for this match/innings?
 */
async function isTrickSettled(matchId, innings, trick) {
  const key = keyOf(matchId, innings, trick);
  if (settledKeys.has(key)) return true;

  const nextCheck = recheckAfter.get(key);
  if (nextCheck && Date.now() < nextCheck) return false;

  if (isDbConnected()) {
    try {
      const record = await ScorecardTrick.findOne({ matchId, innings, trick }).lean();
      if (isTerminal(record)) {
        settledKeys.add(key);
        recheckAfter.delete(key);
        return true;
      }
      recheckAfter.set(key, Date.now() + UNSETTLED_TTL_MS);
      return false;
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to check ScorecardTrick:', err);
      // Fail closed: do not risk duplicate alerts when the DB is unreadable.
      return true;
    }
  }

  const record = fallbackMap.get(key);
  if (isTerminal(record)) {
    settledKeys.add(key);
    recheckAfter.delete(key);
    return true;
  }
  return false;
}

/**
 * Record the outcome of evaluating a trick.
 *
 * @param {object} outcome
 * @param {'NOTIFIED'|'SKIPPED'|'SEND_FAILED'} outcome.status
 */
async function saveTrickOutcome({
  matchId, innings, trick, battingTeam = null,
  playerName = null, summary = null, status
}) {
  const key = keyOf(matchId, innings, trick);
  const notified = status === 'NOTIFIED';

  if (isDbConnected()) {
    try {
      const record = await ScorecardTrick.findOneAndUpdate(
        { matchId, innings, trick },
        {
          $set: { battingTeam, playerName, summary, status, notified },
          ...(status === 'SEND_FAILED' ? { $inc: { attempts: 1 } } : {})
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();

      recheckAfter.delete(key);
      if (isTerminal(record)) settledKeys.add(key);
      logger.info(`💾 [DB] ScorecardTrick ${trick} for match ${matchId} innings ${innings} → ${status}`);
      return;
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to save ScorecardTrick:', err);
      return;
    }
  }

  const existing = fallbackMap.get(key) || { matchId, innings, trick, attempts: 0 };
  const record = {
    ...existing,
    battingTeam, playerName, summary, status, notified,
    attempts: status === 'SEND_FAILED' ? (existing.attempts || 0) + 1 : existing.attempts || 0
  };
  fallbackMap.set(key, record);
  recheckAfter.delete(key);
  if (isTerminal(record)) settledKeys.add(key);
  logger.info(`💾 [InMemory] ScorecardTrick ${trick} for match ${matchId} innings ${innings} → ${status}`);
}

/**
 * Forget in-memory state for matches that are no longer live, so a long-running
 * process does not accumulate keys for finished matches.
 */
function pruneSettledKeys(activeMatchIds) {
  const active = new Set(activeMatchIds);
  for (const key of settledKeys) {
    if (!active.has(key.split('_')[0])) settledKeys.delete(key);
  }
  for (const key of fallbackMap.keys()) {
    if (!active.has(key.split('_')[0])) fallbackMap.delete(key);
  }
  for (const key of recheckAfter.keys()) {
    if (!active.has(key.split('_')[0])) recheckAfter.delete(key);
  }
}

module.exports = { isTrickSettled, saveTrickOutcome, pruneSettledKeys, MAX_SEND_ATTEMPTS };
