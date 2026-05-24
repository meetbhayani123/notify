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
 * Send the T20 Over Runs Trick Alert to the trick notify group/channel.
 */
async function sendTrickNotifyAlert({ matchLabel, innings, battingTeam, runs, threshold }) {
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  const chatId = process.env.TELEGRAM_TRICK_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  
  const message = `📊 *TRICK ALERT — ${innings === 1 ? '1st' : '2nd'} Innings Over Runs!*

🏏 Match   : ${matchLabel}
🏏 Batting : *${battingTeam}* (${innings === 1 ? '1st' : '2nd'} Innings)
📈 1st Over: *${runs} runs*
🎯 Target  : >= ${threshold} runs
⚡ Event   : 1st Over score met the trick criteria!
🕐 Time    : ${time}

_Powered by crex.com live data_`;

  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    });
    return response.data;
  } catch (err) {
    console.error('❌ Telegram trick send failed:', err.response?.data?.description || err.message);
    throw err;
  }
}

/**
 * Send the 2nd Over Wicket Trick Alert to the trick notify channel.
 * Returns the Telegram message_id for reply tracking.
 */
async function sendSecondOverWicketAlert({ matchLabel, innings, battingTeam, runs, wickets, overs }) {
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
  const chatId = process.env.TELEGRAM_TRICK_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

  const message = `🚨 *TRICK — 2nd Over Wicket!*

🏏 Match   : ${matchLabel}
🏏 Batting : *${battingTeam}* (${innings === 1 ? '1st' : '2nd'} Innings)
📊 Score   : *${runs}/${wickets}* (${overs} ov)
⚡ Event   : First wicket fell in the 2nd over
🕐 Time    : ${time}

_Waiting for next wicket before 5th over..._
_Powered by crex.com live data_`;

  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    });
    return response.data?.result?.message_id || null;
  } catch (err) {
    console.error('❌ Telegram 2nd over wicket trick send failed:', err.response?.data?.description || err.message);
    throw err;
  }
}

/**
 * Send a reply on the trick notify channel (for Done/Fail replies on trick messages).
 */
async function sendTrickReply(replyToMessageId, text) {
  const chatId = process.env.TELEGRAM_TRICK_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      reply_to_message_id: replyToMessageId
    });
    return response.data?.result?.message_id || null;
  } catch (err) {
    console.error('❌ Telegram trick reply failed:', err.response?.data?.description || err.message);
    throw err;
  }
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

module.exports = {
  initTelegram,
  sendTelegramAlert,
  sendTelegramReply,
  sendTrickNotifyAlert,
  sendSecondOverWicketAlert,
  sendTrickReply,
  sendTestScoreSummary
};
