/**
 * notifier.js
 * Handles sending messages to a Telegram group/channel.
 */

const axios = require('axios');
require('dotenv').config();

async function initTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    throw new Error('Missing Telegram configuration (TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
  }
}

/**
 * Send a generic message to Telegram, optionally as a reply.
 */
async function sendMessage(text, replyToMessageId = null) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const body = {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: text,
      parse_mode: 'Markdown'
    };
    if (replyToMessageId) {
      body.reply_to_message_id = replyToMessageId;
    }
    const response = await axios.post(url, body);
    return response.data;
  } catch (err) {
    console.error('❌ Telegram send failed:', err.response?.data?.description || err.message);
    throw err;
  }
}

/**
 * Send the production first-over wicket alert.
 */
async function sendTelegramAlert({ matchLabel, matchId, prevWickets, newWickets, overs, runs, battingTeam, innings }) {
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  const message = `🚨 *WICKET ALERT — First Over!*

🏏 Match   : ${matchLabel}
🏏 Batting : *${battingTeam}* (${innings === 1 ? '1st' : '2nd'} Innings)
📊 Score   : *${runs}/${newWickets}* (${overs} ov)
⚡ Event   : Wicket fell in the 1st over
🕐 Time    : ${time}

🔗 *Quick Links:*
• CBTF: https://cbtffreehit.com/sport/in-play
• USDT: https://usdtplayer.com/sport/4

_Powered by crex.com live data_`;

  const data = await sendMessage(message);
  return data?.result?.message_id || null;
}

/**
 * Send a reply to an existing Telegram message.
 */
async function sendTelegramReply(replyToMessageId, text) {
  const data = await sendMessage(text, replyToMessageId);
  return data?.result?.message_id || null;
}

/**
 * Send the test mode live scoreboard.
 */
async function sendTestScoreSummary(liveMatches) {
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  let message = `🧪 *TEST MODE — Live Scoreboard*\n🕐 ${time}\n\n`;

  for (const match of liveMatches) {
    message += `🏏 *${match.label}*\n   📊 ${match.score}\n`;
    if (match.status) message += `   📌 ${match.status}\n`;
    message += '\n';
  }

  message += `_Powered by crex.com live data_`;

  await sendMessage(message);
}

module.exports = { initTelegram, sendTelegramAlert, sendTelegramReply, sendTestScoreSummary };
