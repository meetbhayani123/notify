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
  twilioAlertStatus: { type: String, enum: ['NONE', 'SUCCESS', 'PARTIAL', 'FAILED'], default: 'NONE' },
  twilioError: { type: String, default: null },
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

// Define the MongoDB Schema for the 1st Over Wicket Trick
const wicketTrickSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  innings: { type: Number, required: true },
  battingTeam: { type: String, required: true },
  telegramMessageId: { type: Number, required: true },
  initialWickets: { type: Number, required: true },
  status: { type: String, enum: ['PENDING', 'DONE', 'FAIL'], default: 'PENDING' },
  resolved: { type: Boolean, default: false },
  completedAt: { type: Date, default: null }
}, { timestamps: true });

wicketTrickSchema.index({ matchId: 1, innings: 1 }, { unique: true });

const WicketTrick = mongoose.model('WicketTrick', wicketTrickSchema);

// Define the MongoDB Schema for the T20 Over Runs Trick
const overRunsTrickSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  innings: { type: Number, required: true },
  battingTeam: { type: String, required: true },
  runsAtFirstOver: { type: Number, default: null },
  ballsAtEvaluation: { type: Number, default: null },
  notified: { type: Boolean, default: false },
  status: { type: String, enum: ['PENDING', 'NOTIFIED', 'SKIPPED'], default: 'PENDING' }
}, { timestamps: true });

overRunsTrickSchema.index({ matchId: 1, innings: 1 }, { unique: true });

const OverRunsTrick = mongoose.model('OverRunsTrick', overRunsTrickSchema);

// Define the MongoDB Schema for the 2nd Over Wicket Trick
const secondOverWicketTrickSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  innings: { type: Number, required: true },
  battingTeam: { type: String, required: true },
  telegramMessageId: { type: Number, required: true },
  initialWickets: { type: Number, required: true },
  wicketBalls: { type: Number, required: true }, // ball number when 1st wicket fell in 2nd over
  status: { type: String, enum: ['PENDING', 'DONE', 'FAIL'], default: 'PENDING' },
  resolved: { type: Boolean, default: false },
  completedAt: { type: Date, default: null }
}, { timestamps: true });

secondOverWicketTrickSchema.index({ matchId: 1, innings: 1 }, { unique: true });

const SecondOverWicketTrick = mongoose.model('SecondOverWicketTrick', secondOverWicketTrickSchema);

/**
 * Connect to MongoDB using the MONGODB_URI env variable.
 * Fallback to in-memory map if no URI is provided.
 */
let dbConnected = false;
const fallbackMap = new Map();
const wicketTrickFallbackMap = new Map();
const overRunsTrickFallbackMap = new Map();
const secondOverWicketTrickFallbackMap = new Map();

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

async function saveFirstOverSessionEvent({
  matchId,
  matchLabel,
  innings,
  battingTeam,
  score,
  notified,
  action,
  telegramStatus = null,
  telegramError = null,
  twilioStatus = null,
  twilioError = null
}) {
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

    // Update Twilio call status if relevant
    if (twilioStatus) {
      updateFields.$set.twilioAlertStatus = twilioStatus;
    }
    if (twilioError) {
      updateFields.$set.twilioError = twilioError.message || String(twilioError);
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

/**
 * Create a new Wicket Trick session in MongoDB or the fallback map.
 */
async function createWicketTrick({ matchId, innings, battingTeam, telegramMessageId, initialWickets }) {
  const data = {
    matchId,
    innings,
    battingTeam,
    telegramMessageId,
    initialWickets,
    status: 'PENDING',
    resolved: false
  };

  if (dbConnected) {
    try {
      await WicketTrick.findOneAndUpdate(
        { matchId, innings },
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      logger.info(`💾 [DB] Created WicketTrick for match ${matchId} Innings ${innings}`);
    } catch (err) {
      logger.error(`💾 [DB ERROR] Failed to create WicketTrick:`, err);
    }
  } else {
    wicketTrickFallbackMap.set(`${matchId}_${innings}`, data);
    logger.info(`💾 [InMemory] Created WicketTrick for match ${matchId} Innings ${innings}`);
  }
}

/**
 * Fetch an unresolved Wicket Trick session.
 */
async function getActiveWicketTrick(matchId, innings) {
  if (dbConnected) {
    try {
      return await WicketTrick.findOne({ matchId, innings, resolved: false });
    } catch (err) {
      logger.error(`💾 [DB ERROR] Failed to get active WicketTrick:`, err);
      return null;
    }
  } else {
    const trick = wicketTrickFallbackMap.get(`${matchId}_${innings}`);
    if (trick && !trick.resolved) {
      return trick;
    }
    return null;
  }
}

/**
 * Resolve a Wicket Trick session with DONE or FAIL.
 */
async function resolveWicketTrick(matchId, innings, status) {
  const update = {
    status,
    resolved: true,
    completedAt: new Date()
  };

  if (dbConnected) {
    try {
      await WicketTrick.updateOne({ matchId, innings }, { $set: update });
      logger.info(`💾 [DB] Resolved WicketTrick for match ${matchId} Innings ${innings} as ${status}`);
    } catch (err) {
      logger.error(`💾 [DB ERROR] Failed to resolve WicketTrick:`, err);
    }
  } else {
    const key = `${matchId}_${innings}`;
    const existing = wicketTrickFallbackMap.get(key);
    if (existing) {
      existing.status = status;
      existing.resolved = true;
      existing.completedAt = new Date();
      wicketTrickFallbackMap.set(key, existing);
      logger.info(`💾 [InMemory] Resolved WicketTrick for match ${matchId} Innings ${innings} as ${status}`);
    }
  }
}

/**
 * Sweep and resolve orphaned pending tricks.
 */
async function sweepOrphanedTricks(activeMatchIds, sendTelegramReplyFn) {
  if (!dbConnected) {
    // Also cleanup in-memory tricks for inactive matches
    for (const [key, trick] of wicketTrickFallbackMap.entries()) {
      if (!trick.resolved && !activeMatchIds.includes(trick.matchId)) {
        logger.info(`🧹 [InMemory SWEEP] Found orphaned pending trick for match ${trick.matchId} (innings ${trick.innings}). Marking as FAIL.`);
        try {
          if (sendTelegramReplyFn) {
            await sendTelegramReplyFn(trick.telegramMessageId, 'Fail ❌');
          }
        } catch (err) {
          logger.error(`[SWEEP ERROR] Failed to reply to orphaned trick:`, err);
        }
        trick.status = 'FAIL';
        trick.resolved = true;
        trick.completedAt = new Date();
        wicketTrickFallbackMap.set(key, trick);
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
        if (sendTelegramReplyFn) {
          await sendTelegramReplyFn(trick.telegramMessageId, 'Fail ❌');
        }
      } catch (err) {
        logger.error(`[SWEEP ERROR] Failed to send Telegram reply during sweep for match ${trick.matchId}:`, err);
      }
      await resolveWicketTrick(trick.matchId, trick.innings, 'FAIL');
    }
  } catch (err) {
    logger.error('💾 [DB ERROR] Failed during orphaned tricks sweep:', err);
  }
}

/**
 * Retrieve the runs scored at the end of the 1st over (exactly 6 balls).
 * Looks up the FirstOverSession events in MongoDB or fallback.
 */
async function getFirstOverRuns(matchId, innings, currentScore) {
  if (currentScore.balls === 6) {
    return currentScore.runs;
  }

  if (dbConnected) {
    try {
      const session = await FirstOverSession.findOne({ matchId, innings });
      if (session && session.events && session.events.length > 0) {
        // Find the event closest to 6 balls (i.e. <= 6 balls)
        const relevantEvents = session.events
          .filter(e => e.balls <= 6)
          .sort((a, b) => b.balls - a.balls); // descending order of balls

        if (relevantEvents.length > 0) {
          logger.info(`🔍 [DB] Found first over runs from event history: ${relevantEvents[0].runs} runs at ball ${relevantEvents[0].balls}`);
          return relevantEvents[0].runs;
        }
      }
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to fetch first over runs from session:', err);
    }
  }

  // If we are past the first over (> 6 balls) and could not find first over events in the DB,
  // we cannot fall back to currentScore.runs because that represents runs at a later stage of the match.
  if (currentScore.balls > 6) {
    return null;
  }

  // Fallback: if we don't have events or DB is not connected, use current score runs
  return currentScore.runs;
}

/**
 * Check if the Over Runs Trick has already been evaluated for this match and innings.
 */
async function checkOverRunsTrickEvaluated(matchId, innings) {
  if (dbConnected) {
    try {
      const existing = await OverRunsTrick.findOne({ matchId, innings });
      return !!existing;
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to check OverRunsTrick:', err);
      return false;
    }
  } else {
    return overRunsTrickFallbackMap.has(`${matchId}_${innings}`);
  }
}

/**
 * Save the evaluation details of the Over Runs Trick.
 */
async function saveOverRunsTrickEvaluation({ matchId, innings, battingTeam, runsAtFirstOver, ballsAtEvaluation, notified, status }) {
  const data = {
    matchId,
    innings,
    battingTeam,
    runsAtFirstOver,
    ballsAtEvaluation,
    notified,
    status
  };

  if (dbConnected) {
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
    overRunsTrickFallbackMap.set(`${matchId}_${innings}`, data);
    logger.info(`💾 [InMemory] Evaluated OverRunsTrick for match ${matchId} Innings ${innings} (Runs: ${runsAtFirstOver}, Status: ${status})`);
  }
}

/**
 * Create a new Second Over Wicket Trick session.
 */
async function createSecondOverWicketTrick({ matchId, innings, battingTeam, telegramMessageId, initialWickets, wicketBalls }) {
  const data = {
    matchId,
    innings,
    battingTeam,
    telegramMessageId,
    initialWickets,
    wicketBalls,
    status: 'PENDING',
    resolved: false
  };

  if (dbConnected) {
    try {
      await SecondOverWicketTrick.findOneAndUpdate(
        { matchId, innings },
        { $set: data },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      logger.info(`💾 [DB] Created SecondOverWicketTrick for match ${matchId} Innings ${innings}`);
    } catch (err) {
      logger.error(`💾 [DB ERROR] Failed to create SecondOverWicketTrick:`, err);
    }
  } else {
    secondOverWicketTrickFallbackMap.set(`${matchId}_${innings}`, data);
    logger.info(`💾 [InMemory] Created SecondOverWicketTrick for match ${matchId} Innings ${innings}`);
  }
}

/**
 * Fetch an unresolved Second Over Wicket Trick session.
 */
async function getActiveSecondOverWicketTrick(matchId, innings) {
  if (dbConnected) {
    try {
      return await SecondOverWicketTrick.findOne({ matchId, innings, resolved: false });
    } catch (err) {
      logger.error(`💾 [DB ERROR] Failed to get active SecondOverWicketTrick:`, err);
      return null;
    }
  } else {
    const trick = secondOverWicketTrickFallbackMap.get(`${matchId}_${innings}`);
    if (trick && !trick.resolved) {
      return trick;
    }
    return null;
  }
}

/**
 * Resolve a Second Over Wicket Trick session with DONE or FAIL.
 */
async function resolveSecondOverWicketTrick(matchId, innings, status) {
  const update = {
    status,
    resolved: true,
    completedAt: new Date()
  };

  if (dbConnected) {
    try {
      await SecondOverWicketTrick.updateOne({ matchId, innings }, { $set: update });
      logger.info(`💾 [DB] Resolved SecondOverWicketTrick for match ${matchId} Innings ${innings} as ${status}`);
    } catch (err) {
      logger.error(`💾 [DB ERROR] Failed to resolve SecondOverWicketTrick:`, err);
    }
  } else {
    const key = `${matchId}_${innings}`;
    const existing = secondOverWicketTrickFallbackMap.get(key);
    if (existing) {
      existing.status = status;
      existing.resolved = true;
      existing.completedAt = new Date();
      secondOverWicketTrickFallbackMap.set(key, existing);
      logger.info(`💾 [InMemory] Resolved SecondOverWicketTrick for match ${matchId} Innings ${innings} as ${status}`);
    }
  }
}

/**
 * Check if the 2nd Over Wicket trick has already been evaluated/created for this match and innings.
 */
async function checkSecondOverWicketTrickExists(matchId, innings) {
  if (dbConnected) {
    try {
      const existing = await SecondOverWicketTrick.findOne({ matchId, innings });
      return !!existing;
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to check SecondOverWicketTrick:', err);
      return false;
    }
  } else {
    return secondOverWicketTrickFallbackMap.has(`${matchId}_${innings}`);
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
  isDbConnected,
  createWicketTrick,
  getActiveWicketTrick,
  resolveWicketTrick,
  sweepOrphanedTricks,
  getFirstOverRuns,
  checkOverRunsTrickEvaluated,
  saveOverRunsTrickEvaluation,
  createSecondOverWicketTrick,
  getActiveSecondOverWicketTrick,
  resolveSecondOverWicketTrick,
  checkSecondOverWicketTrickExists
};
