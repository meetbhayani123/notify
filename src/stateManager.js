/**
 * stateManager.js
 * Tracks wicket state across polls.
 * Now powered by MongoDB to prevent duplicate alerts even after server restarts!
 */

const mongoose = require('mongoose');

// Define the MongoDB Schema
const matchStateSchema = new mongoose.Schema({
  matchId: { type: String, required: true, unique: true },
  wickets: { type: Number, default: 0 },
  overs: { type: Number, default: 0 },
  notified: { type: Boolean, default: false }
});

const MatchState = mongoose.model('MatchState', matchStateSchema);

/**
 * Connect to MongoDB using the MONGODB_URI env variable.
 * Fallback to in-memory map if no URI is provided.
 */
let dbConnected = false;
const fallbackMap = new Map();

async function initDB() {
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      dbConnected = true;
      console.log('✅ Connected to MongoDB! Alert state will persist across restarts.');
    } catch (err) {
      console.error('❌ MongoDB Connection Error:', err.message);
      console.warn('⚠️ Falling back to in-memory tracking.');
    }
  } else {
    console.warn('⚠️ No MONGODB_URI provided in .env. Using in-memory state (alerts may duplicate on restart).');
  }
}

/**
 * Compare the incoming score with stored state and decide
 * whether a first-over wicket just fell.
 */
async function checkForWicket(matchId, score) {
  let prev;

  if (dbConnected) {
    prev = await MatchState.findOne({ matchId });
  } else {
    prev = fallbackMap.get(matchId);
  }

  // First observation — just record, don't alert
  if (!prev) {
    const newState = { matchId, wickets: score.wickets, overs: score.overs, notified: false };
    if (dbConnected) await MatchState.create(newState);
    else fallbackMap.set(matchId, newState);
    return { wicketFell: false };
  }

  // Detect innings reset: overs dropped significantly → new innings
  if (score.overs < prev.overs - 1) {
    const updatedState = { wickets: score.wickets, overs: score.overs, notified: false };
    if (dbConnected) await MatchState.updateOne({ matchId }, { $set: updatedState });
    else fallbackMap.set(matchId, { ...prev, ...updatedState });
    return { wicketFell: false };
  }

  const wicketFell =
    score.wickets > prev.wickets &&   // wickets increased
    score.isFirstOver &&               // still in the first over
    !prev.notified;                    // not yet alerted this innings

  // Update stored state
  const newNotified = prev.notified || wicketFell;
  
  if (dbConnected) {
    await MatchState.updateOne(
      { matchId }, 
      { $set: { wickets: score.wickets, overs: score.overs, notified: newNotified } }
    );
  } else {
    fallbackMap.set(matchId, { wickets: score.wickets, overs: score.overs, notified: newNotified });
  }

  if (wicketFell) {
    return {
      wicketFell: true,
      prevWickets: prev.wickets,
      newWickets:  score.wickets
    };
  }

  return { wicketFell: false };
}

module.exports = { initDB, checkForWicket };
