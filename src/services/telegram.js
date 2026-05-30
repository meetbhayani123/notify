/**
 * services/telegram.js
 * Handles all Telegram Bot API communication.
 * Single sendToChat() helper used by all alert builders — DRY.
 */

const axios = require('axios');
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_TRICK_CHAT_ID } = require('../config');
const logger = require('../lib/logger');

/**
 * Get the current IST timestamp string for alert messages.
 */
function getISTTime() {
  return new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/**
 * Get the innings display label.
 */
function inningsLabel(innings) {
  return innings === 1 ? '1st' : '2nd';
}

// ── Core send helper ────────────────────────────────────
async function sendToChat(chatId, text, replyToMessageId = null) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId;

  try {
    const response = await axios.post(url, body);
    return response.data;
  } catch (err) {
    logger.error(`Telegram send failed (chat: ${chatId}):`, err);
    throw err;
  }
}

// ── Init (validation only) ──────────────────────────────
async function initTelegram() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw new Error('Missing Telegram configuration (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
  }
}

// ── First-over wicket alert → main channel ──────────────
async function sendTelegramAlert({ matchLabel, newWickets, overs, runs, battingTeam, innings }) {
  const message = `🚨 *WICKET ALERT — First Over!*

🏏 Match   : ${matchLabel}
🏏 Batting : *${battingTeam}* (${inningsLabel(innings)} Innings)
📊 Score   : *${runs}/${newWickets}* (${overs} ov)
⚡ Event   : Wicket fell in the 1st over
🕐 Time    : ${getISTTime()}

🔗 *Quick Links:*
• CBTF: https://cbtffreehit.com/sport/in-play
• USDT: https://usdtplayer.com/sport/4

_Powered by crex.com live data_`;

  const data = await sendToChat(TELEGRAM_CHAT_ID, message);
  return data?.result?.message_id || null;
}

// ── Reply to existing message → main channel ────────────
async function sendTelegramReply(replyToMessageId, text) {
  const data = await sendToChat(TELEGRAM_CHAT_ID, text, replyToMessageId);
  return data?.result?.message_id || null;
}

// ── Over Runs Trick alert → trick channel ───────────────
async function sendTrickNotifyAlert({ matchLabel, innings, battingTeam, runs, threshold }) {
  const inn = inningsLabel(innings);
  const message = `📊 *TRICK ALERT — ${inn} Innings Over Runs!*

🏏 Match   : ${matchLabel}
🏏 Batting : *${battingTeam}* (${inn} Innings)
📈 1st Over: *${runs} runs*
🎯 Target  : >= ${threshold} runs
⚡ Event   : 1st Over score met the trick criteria!
🕐 Time    : ${getISTTime()}

_Powered by crex.com live data_`;

  const data = await sendToChat(TELEGRAM_TRICK_CHAT_ID, message);
  return data;
}

// ── 2nd Over Wicket alert → main channel ────────────────
async function sendSecondOverWicketAlert({ matchLabel, innings, battingTeam, runs, wickets, overs }) {
  const message = `🚨 *TRICK — 2nd Over Wicket!*

🏏 Match   : ${matchLabel}
🏏 Batting : *${battingTeam}* (${inningsLabel(innings)} Innings)
📊 Score   : *${runs}/${wickets}* (${overs} ov)
⚡ Event   : First wicket fell in the 2nd over
🕐 Time    : ${getISTTime()}

_Waiting for next wicket before 5th over..._
_Powered by crex.com live data_`;

  const data = await sendToChat(TELEGRAM_CHAT_ID, message);
  return data?.result?.message_id || null;
}

// ── Test mode scoreboard ────────────────────────────────
async function sendTestScoreSummary(liveMatches) {
  let message = `🧪 *TEST MODE — Live Scoreboard*\n🕐 ${getISTTime()}\n\n`;

  for (const match of liveMatches) {
    message += `🏏 *${match.label}*\n   📊 ${match.score}\n`;
    if (match.status) message += `   📌 ${match.status}\n`;
    message += '\n';
  }
  message += `_Powered by crex.com live data_`;

  await sendToChat(TELEGRAM_CHAT_ID, message);
}

module.exports = {
  initTelegram,
  sendTelegramAlert,
  sendTelegramReply,
  sendTrickNotifyAlert,
  sendSecondOverWicketAlert,
  sendTestScoreSummary
};
