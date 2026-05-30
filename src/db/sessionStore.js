/**
 * db/sessionStore.js
 * Manages FirstOverSession events and first-over run lookups.
 */

const { isDbConnected } = require('./connection');
const FirstOverSession = require('./models/FirstOverSession');
const logger = require('../lib/logger');

async function saveFirstOverSessionEvent({
  matchId, matchLabel, innings, battingTeam, score,
  notified, action, telegramStatus = null, telegramError = null
}) {
  if (!isDbConnected()) return;
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
      $set: { matchLabel, battingTeam },
      $push: { events: event }
    };

    if (action === 'alert_triggered') {
      updateFields.$set.notified = true;
      updateFields.$set.notifiedAt = new Date();
      updateFields.$set.alertTriggerScore = `${score.runs}/${score.wickets}(${score.overs} ov)`;
    }
    if (telegramStatus) updateFields.$set.telegramAlertStatus = telegramStatus;
    if (telegramError) updateFields.$set.telegramError = telegramError.message || String(telegramError);

    await FirstOverSession.findOneAndUpdate(
      { matchId, innings },
      updateFields,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    logger.error('Failed to save first over session event to MongoDB:', err);
  }
}

/**
 * Retrieve the runs scored at the end of the 1st over (exactly 6 balls).
 */
async function getFirstOverRuns(matchId, innings, currentScore) {
  if (currentScore.balls === 6) {
    return currentScore.runs;
  }

  if (isDbConnected()) {
    try {
      const session = await FirstOverSession.findOne({ matchId, innings });
      if (session && session.events && session.events.length > 0) {
        const relevantEvents = session.events
          .filter(e => e.balls <= 6)
          .sort((a, b) => b.balls - a.balls);

        if (relevantEvents.length > 0) {
          logger.info(`🔍 [DB] Found first over runs from event history: ${relevantEvents[0].runs} runs at ball ${relevantEvents[0].balls}`);
          return relevantEvents[0].runs;
        }
      }
    } catch (err) {
      logger.error('💾 [DB ERROR] Failed to fetch first over runs from session:', err);
    }
  }

  if (currentScore.balls > 6) {
    return null;
  }
  return currentScore.runs;
}

module.exports = { saveFirstOverSessionEvent, getFirstOverRuns };
