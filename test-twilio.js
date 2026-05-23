/**
 * test-twilio.js
 * Quick script to trigger a single test voice call using the configured .env parameters.
 */

require('dotenv').config();
const { initTwilio, triggerVoiceAlert } = require('./src/twilioNotifier');
const logger = require('./src/logger');

async function test() {
  logger.info('🚀 Starting live Twilio voice call test script...');

  // Initialize Twilio client
  initTwilio();

  logger.info('📞 Placing a simulated test voice alert...');
  
  // Trigger a simulated voice call alert using dummy data
  const result = await triggerVoiceAlert({
    battingTeam: 'Royal Challengers Bengaluru',
    runs: 4,
    wickets: 1,
    overs: 0.3
  });

  logger.info('📋 Call Execution Results Summary:');
  console.log(JSON.stringify(result, null, 2));

  if (result.status === 'SUCCESS' || result.status === 'PARTIAL') {
    logger.success('🎉 Test call placed successfully!');
  } else {
    logger.error('❌ Test call failed. Please double-check your .env parameters and console log details.');
  }
}

test().catch(err => {
  logger.error('Unhandled script failure', err);
});
