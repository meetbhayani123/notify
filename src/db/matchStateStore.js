/**
 * db/matchStateStore.js
 * Tracks wicket state across polls with MongoDB + in-memory fallback.
 */

const { isDbConnected } = require('./connection');
const MatchState = require('./models/MatchState');

const fallbackMap = new Map();

/**
 * Compare the incoming score with stored state and decide
 * whether a first-over wicket just fell.
 */
async function checkForWicket(matchId, score) {
  let prev;

  if (isDbConnected()) {
    prev = await MatchState.findOne({ matchId });
  } else {
    prev = fallbackMap.get(matchId);
  }

  const isNewOrReset = !prev || (score.overs < prev.overs - 1);
  const hasNotified = (!isNewOrReset && prev) ? prev.notified : false;

  // Standard detection: wicket seen while still in the first over (0.1–1.0).
  // Only triggers when isFirstOver is true (balls 1–6), ensuring wickets
  // at 1.1+ (2nd over) are NOT incorrectly flagged as first-over wickets.
  // Those are handled separately by the secondOverWicket strategy.
  const wicketFell =
    score.isFirstOver &&
    score.wickets > 0 &&
    !hasNotified;

  const newNotified = hasNotified || wicketFell;

  const newState = {
    matchId,
    wickets: score.wickets,
    overs: score.overs,
    notified: newNotified
  };

  if (isDbConnected()) {
    if (!prev) {
      await MatchState.create(newState);
    } else {
      await MatchState.updateOne(
        { matchId },
        { $set: { wickets: score.wickets, overs: score.overs, notified: newNotified } }
      );
    }
  } else {
    fallbackMap.set(matchId, newState);
  }

  if (wicketFell) {
    return { wicketFell: true, newWickets: score.wickets };
  }
  return { wicketFell: false };
}

async function getMatchState(matchId) {
  if (isDbConnected()) {
    try {
      return await MatchState.findOne({ matchId });
    } catch {
      return null;
    }
  }
  return fallbackMap.get(matchId) || null;
}

module.exports = { checkForWicket, getMatchState };
