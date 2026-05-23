/**
 * test-trick.js
 * Quick script to test the Wicket Trick Alert, Replies, and the T20 Over Runs Trick Alert.
 */

require('dotenv').config();
const { initTelegram, sendTelegramAlert, sendTelegramReply, sendTrickNotifyAlert } = require('./src/notifier');
const logger = require('./src/logger');

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function test() {
  logger.info('🚀 Starting Telegram Tricks test script...');

  // Initialize Telegram configurations
  await initTelegram();

  logger.info('1. Testing Wicket Alert & Replies...');
  try {
    // 1. Send initial wicket alert
    logger.info('📤 Sending simulated 1st Over Wicket Alert to primary channel...');
    const messageId = await sendTelegramAlert({
      matchLabel: '[T20] Sim Match vs Sim Team (id: TEST1234)',
      matchId: 'TEST1234',
      prevWickets: 0,
      newWickets: 1,
      overs: 0.2,
      runs: 4,
      battingTeam: 'Simulated Battings',
      innings: 1
    });

    if (messageId) {
      logger.success(`🎉 Alert sent successfully! Message ID: ${messageId}`);
      
      // Wait 3 seconds to let user see the message
      logger.info('⏳ Waiting 3 seconds before replying...');
      await wait(3000);

      // 2. Send "Done ✅" reply
      logger.info(`📤 Sending reply "Done ✅" to message ID ${messageId}...`);
      await sendTelegramReply(messageId, 'Done ✅');
      logger.success('🎉 "Done ✅" reply sent successfully!');
      
      // Wait 3 seconds
      logger.info('⏳ Waiting 3 seconds before sending fail reply...');
      await wait(3000);

      // 3. Send "Fail ❌" reply
      logger.info(`📤 Sending reply "Fail ❌" to message ID ${messageId}...`);
      await sendTelegramReply(messageId, 'Fail ❌');
      logger.success('🎉 "Fail ❌" reply sent successfully!');
    } else {
      logger.error('❌ Failed to get message ID back from alert.');
    }
  } catch (err) {
    logger.error('❌ Wicket alert/reply test failed:', err);
  }

  logger.info('----------------------------------------------');
  logger.info('2. Testing T20 Over Runs Trick Alert...');
  try {
    const trickChatId = process.env.TELEGRAM_TRICK_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    logger.info(`📤 Sending T20 Over Runs Trick Alert to chat ID ${trickChatId} ("trick notify" channel)...`);
    
    await sendTrickNotifyAlert({
      matchLabel: '[T20] HighScorer vs LowScorer (id: RUNS5678)',
      innings: 1,
      battingTeam: 'HighScorer',
      runs: 16,
      threshold: 14
    });
    
    logger.success('🎉 T20 Over Runs Trick Alert sent successfully!');
  } catch (err) {
    logger.error('❌ T20 Over Runs Trick Alert test failed:', err);
  }

  logger.info('🏁 Telegram Tricks test finished!');
}

test().catch(err => {
  logger.error('Unhandled script failure', err);
});
