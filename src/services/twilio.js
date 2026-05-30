/**
 * services/twilio.js
 * Handles sending automated voice alerts using Twilio Voice API.
 * Currently disabled via ENABLE_TWILIO_CALLS=false in .env.
 */

const logger = require('../lib/logger');

let client = null;
let enabled = false;
let fromNumber = '';
let targetNumbers = [];

/**
 * Normalizes phone numbers to standard E.164 format.
 */
function normalizePhoneNumber(num) {
  let clean = num.trim().replace(/[-\s()]/g, '');

  if (clean.startsWith('+')) return clean;
  if (clean.length === 10) return `+91${clean}`;
  if (clean.length === 12 && clean.startsWith('91')) return `+${clean}`;
  if (clean.length >= 8 && /^\d+$/.test(clean)) return `+${clean}`;

  return clean;
}

/**
 * Initializes Twilio configuration and validates required environment variables.
 */
function initTwilio() {
  const enableTwilio = process.env.ENABLE_TWILIO_CALLS !== 'false';

  if (!enableTwilio) {
    logger.warn('Twilio voice calling is explicitly disabled (ENABLE_TWILIO_CALLS=false). No voice alerts will be triggered.');
    enabled = false;
    return;
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  fromNumber = process.env.TWILIO_FROM_NUMBER;
  const toNumbersRaw = process.env.TWILIO_TO_NUMBERS;

  const hasPlaceholders =
    (sid && sid.includes('your_')) ||
    (token && token.includes('your_')) ||
    (fromNumber && fromNumber.includes('your_'));

  if (!sid || !token || !fromNumber || !toNumbersRaw || hasPlaceholders) {
    logger.warn('Twilio configuration is incomplete or contains placeholder values. Voice calling will be disabled.');
    enabled = false;
    return;
  }

  try {
    const twilio = require('twilio');
    client = twilio(sid, token);
    fromNumber = normalizePhoneNumber(fromNumber);

    targetNumbers = toNumbersRaw
      .split(',')
      .map(num => num.trim())
      .filter(num => num.length > 0)
      .map(normalizePhoneNumber);

    if (targetNumbers.length === 0) {
      logger.warn('Twilio configured but no valid target numbers found in TWILIO_TO_NUMBERS.');
      enabled = false;
      return;
    }

    enabled = true;
    logger.success(`Twilio Voice initialized. Will call ${targetNumbers.length} number(s): ${targetNumbers.join(', ')}`);
  } catch (err) {
    logger.error('Failed to initialize Twilio client', err);
    enabled = false;
  }
}

/**
 * Trigger voice calls to all configured numbers concurrently.
 */
async function triggerVoiceAlert({ battingTeam, runs, wickets, overs }) {
  if (!enabled) {
    logger.info('Twilio voice calls skipped (not configured or disabled).');
    return { status: 'DISABLED', results: [] };
  }

  const ttsMessage = `Alert! Wicket down! Please check your application. A wicket has fallen in the first over. ${battingTeam} is currently at ${runs} runs for ${wickets} wickets in ${overs} overs. Check the game immediately.`;
  const twimlXml = `<Response><Say voice="alice" language="en-US">${ttsMessage}</Say></Response>`;

  logger.info(`📞 Triggering Twilio voice calls to ${targetNumbers.length} recipients...`);

  const callPromises = targetNumbers.map(async (toNum) => {
    try {
      const call = await client.calls.create({
        twiml: twimlXml,
        to: toNum,
        from: fromNumber,
        timeout: 30
      });
      logger.success(`Successfully initiated call to ${toNum} (SID: ${call.sid})`);
      return { to: toNum, success: true, callSid: call.sid };
    } catch (err) {
      logger.error(`Failed to place Twilio call to ${toNum}`, err);
      return { to: toNum, success: false, error: err.message || err };
    }
  });

  const results = await Promise.allSettled(callPromises);
  const formattedResults = results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: 'Promise rejected' });
  const allSuccessful = formattedResults.every(r => r.success);

  return {
    status: allSuccessful ? 'SUCCESS' : (formattedResults.some(r => r.success) ? 'PARTIAL' : 'FAILED'),
    results: formattedResults
  };
}

module.exports = { initTwilio, triggerVoiceAlert, isEnabled: () => enabled };
