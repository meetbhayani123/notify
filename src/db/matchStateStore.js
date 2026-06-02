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

  // Standard detection: wicket seen while still in the first over
  const directDetection =
    score.isFirstOver &&
    score.wickets > 0 &&
    !hasNotified;

  // Safety-net: wicket fell on the LAST ball of over 1 but poll only sees it
  // in the early 2nd over (1.1–2.0). Previous poll was in the 1st over with
  // 0 wickets, now we see wickets > 0 just past the 1st over b oundary.
  const retroDetection =
    !hasNotified &&
    !score.isFirstOver &&
    score.overs >= 1.1 && score.overs <= 2.0 &&
    score.wickets > 0 &&
    prev && prev.overs <= 1.0 && prev.wickets === 0;

  const wicketFell = directDetection || retroDetection;

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
