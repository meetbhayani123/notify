/**
 * stateManager.js
 * Tracks wicket state across polls.
 * Now powered by MongoDB to prevent duplicate alerts even after server restarts!
 */

const mongoose = require('mongoose');
const logger = require('./logger');

// Define the MongoDB Schema
const matchStateSchema = new mongoose.Schema({
  matchId: { type: String, required: true, unique: true },
  wickets: { type: Number, default: 0 },
  overs: { type: Number, default: 0 },
  notified: { type: Boolean, default: false }
}, { timestamps: true });

const MatchState = mongoose.model('MatchState', matchStateSchema);

// Define the MongoDB Schema for Match First Over History Event sub-document
const firstOverEventSchema = new mongoose.Schema({
  createdAt: { type: Date, default: Date.now },
  overs: { type: Number, required: true },
  runs: { type: Number, required: true },
  wickets: { type: Number, required: true },
  balls: { type: Number, required: true },
  action: { type: String, required: true }, // 'poll_received', 'alert_triggered', 'alert_success', 'alert_failed'
  notified: { type: Boolean, required: true }
});

// Define the MongoDB Schema for First Over Tracking Sessions
const firstOverSessionSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  matchLabel: { type: String, required: true },
  innings: { type: Number, required: true },
  battingTeam: { type: String, required: true },
  notified: { type: Boolean, default: false },
  notifiedAt: { type: Date, default: null },
  alertTriggerScore: { type: String, default: null },
  telegramAlertStatus: { type: String, enum: ['NONE', 'SUCCESS', 'FAILED'], default: 'NONE' },
  telegramError: { type: String, default: null },
  events: [firstOverEventSchema]
}, { timestamps: true });

firstOverSessionSchema.index({ matchId: 1, innings: 1 }, { unique: true });

const FirstOverSession = mongoose.model('FirstOverSession', firstOverSessionSchema);

// Define the MongoDB Schema for System Logs
const systemLogSchema = new mongoose.Schema({
  level: { type: String, required: true },
  message: { type: String, required: true },
  errorDetails: { type: String, default: null }
}, { timestamps: true });

const SystemLog = mongoose.model('SystemLog', systemLogSchema);

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
      logger.success('Connected to MongoDB! Alert state will persist across restarts.');
    } catch (err) {
      logger.error('MongoDB Connection Error', err);
      logger.warn('Falling back to in-memory tracking.');
    }
  } else {
    logger.warn('No MONGODB_URI provided in .env. Using in-memory state (alerts may duplicate on restart).');
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

  // Detect if this is a brand new observation or an innings reset
  const isNewOrReset = !prev || (score.overs < prev.overs - 1);

  // We should notify if:
  // 1. It is the first over
  // 2. At least one wicket has fallen
  // 3. We haven't notified yet for this innings
  const hasNotified = (!isNewOrReset && prev) ? prev.notified : false;
  const prevWickets = (!isNewOrReset && prev) ? prev.wickets : 0;

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

  if (dbConnected) {
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
    return {
      wicketFell: true,
      prevWickets: prevWickets,
      newWickets: score.wickets
    };
  }

  return { wicketFell: false };
}

async function getMatchState(matchId) {
  if (dbConnected) {
    try {
      return await MatchState.findOne({ matchId });
    } catch (err) {
      return null;
    }
  } else {
    return fallbackMap.get(matchId) || null;
  }
}

async function saveSystemLog(level, message, error = null) {
  if (!dbConnected) return;
  try {
    let errorDetails = null;
    if (error) {
      errorDetails = error.stack || error.message || String(error);
    }
    await SystemLog.create({
      level,
      message,
      errorDetails
    });
  } catch (err) {
    console.error('💾 [DB ERROR] Failed to save system log to MongoDB:', err.message);
  }
}

async function saveFirstOverSessionEvent({ matchId, matchLabel, innings, battingTeam, score, notified, action, telegramStatus = null, telegramError = null }) {
  if (!dbConnected) return;
  try {
    const event = {
      overs: score.overs,
      runs: score.runs,
      wickets: score.wickets,
      balls: score.balls,
      action,
      notified
    };

    const updateFields = {
      $set: {
        matchLabel,
        battingTeam
      },
      $push: {
        events: event
      }
    };

    // If an alert was triggered, update notification status
    if (action === 'alert_triggered') {
      updateFields.$set.notified = true;
      updateFields.$set.notifiedAt = new Date();
      updateFields.$set.alertTriggerScore = `${score.runs}/${score.wickets}(${score.overs} ov)`;
    }

    // Update Telegram send status if relevant
    if (telegramStatus) {
      updateFields.$set.telegramAlertStatus = telegramStatus;
    }
    if (telegramError) {
      updateFields.$set.telegramError = telegramError.message || String(telegramError);
    }

    // Upsert the session document based on matchId and innings
    await FirstOverSession.findOneAndUpdate(
      { matchId, innings },
      updateFields,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error('💾 [DB ERROR] Failed to save first over session event to MongoDB:', err.message);
  }
}

function isDbConnected() {
  return dbConnected;
}

module.exports = {
  initDB,
  checkForWicket,
  getMatchState,
  saveSystemLog,
  saveFirstOverSessionEvent,
  isDbConnected
};
