/**
 * services/telegram.js
 * Handles all Telegram Bot API communication.
 *
 * Message design principles (mobile-first):
 *   1. First 2 lines = notification preview → show alert type + score
 *   2. Compact layout — no label:value form; natural short text
 *   3. Emojis used sparingly for visual hierarchy, not decoration
 *   4. Series / venue in a quiet footer — not mixed into the alert body
 *   5. Bold only for the numbers & team that matter most
 */

const axios = require('axios');
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_TRICK_CHAT_ID } = require('../config');
const logger = require('../lib/logger');

// ── Helpers ─────────────────────────────────────────────

/** Current IST time string (compact). */
function getISTTime() {
  return new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/** Short innings tag. */
function innTag(innings) {
  return innings === 1 ? '1st Inn' : '2nd Inn';
}

/**
 * Build a quiet footer block with series / venue.
 * Placed at the bottom so the important info stays up top.
 * Skips full team names — matchLabel already has abbreviations.
 */
function contextFooter(matchInfo) {
  if (!matchInfo) return '';
  const parts = [];
  if (matchInfo.seriesName) parts.push(`🏆 ${matchInfo.seriesName}`);
  if (matchInfo.venue)      parts.push(`📍 ${matchInfo.venue}`);
  return parts.length > 0 ? '\n' + parts.join('\n') : '';
}

/** Quick-links one-liner. */
function quickLinks() {
  return `[CBTF](https://cbtffreehit.com/sport/in-play)  ·  [USDT](https://usdtplayer.com/sport/4)`;
}

// ── Core send helper ────────────────────────────────────
async function sendToChat(chatId, text, replyToMessageId = null) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  };
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
async function sendTelegramAlert({ matchLabel, newWickets, overs, runs, battingTeam, innings, matchInfo }) {
  const fullNames = (matchInfo && matchInfo.teamAFull && matchInfo.teamBFull)
    ? `${matchInfo.teamAFull} vs ${matchInfo.teamBFull}`
    : matchLabel;

  const message = [
    `🚨 *1ST OVER WICKET!*`,
    `*${battingTeam}*  ·  *${runs}/${newWickets}* (${overs} ov)`,
    `🏐 ${fullNames}`,
    `${matchLabel}  ·  ${innTag(innings)}`,
    ``,
    `⚡ Wicket fell in the 1st over`,
    contextFooter(matchInfo),
    `⏰ ${getISTTime()}`,
    ``,
    `🔗 ${quickLinks()}`,
  ].filter(l => l !== null).join('\n');

  const data = await sendToChat(TELEGRAM_CHAT_ID, message);
  return data?.result?.message_id || null;
}

// ── Reply to existing message → main channel ────────────
async function sendTelegramReply(replyToMessageId, text) {
  const data = await sendToChat(TELEGRAM_CHAT_ID, text, replyToMessageId);
  return data?.result?.message_id || null;
}

// ── Over Runs Trick alert → trick channel ───────────────
async function sendTrickNotifyAlert({ matchLabel, innings, battingTeam, runs, threshold, matchInfo }) {
  const fullNames = (matchInfo && matchInfo.teamAFull && matchInfo.teamBFull)
    ? `${matchInfo.teamAFull} vs ${matchInfo.teamBFull}`
    : matchLabel;

  const message = [
    `📈 *1ST OVER RUNS — TRICK*`,
    `*${battingTeam}* scored *${runs} runs* in 1st over`,
    `🏐 ${fullNames}`,
    `${matchLabel}  ·  ${innTag(innings)}`,
    `🎯 Target ≥ ${threshold} runs`,
    contextFooter(matchInfo),
    `⏰ ${getISTTime()}`,
  ].filter(l => l !== null).join('\n');

  const data = await sendToChat(TELEGRAM_TRICK_CHAT_ID, message);
  return data;
}

// ── 2nd Over Wicket alert → trick channel ───────────────
async function sendSecondOverWicketAlert({ matchLabel, innings, battingTeam, runs, wickets, overs, matchInfo }) {
  const event = wickets === 1
    ? 'First wicket fell in 2nd over'
    : `Wicket #${wickets} fell in 2nd over`;

  const fullNames = (matchInfo && matchInfo.teamAFull && matchInfo.teamBFull)
    ? `${matchInfo.teamAFull} vs ${matchInfo.teamBFull}`
    : matchLabel;

  const message = [
    `🎯 *2ND OVER WICKET — TRICK*`,
    `*${battingTeam}*  ·  *${runs}/${wickets}* (${overs} ov)`,
    `🏐 ${fullNames}`,
    `${matchLabel}  ·  ${innTag(innings)}`,
    ``,
    `⚡ ${event}`,
    `⏳ _Next wicket before 5th over..._`,
    contextFooter(matchInfo),
    `⏰ ${getISTTime()}`,
  ].filter(l => l !== null).join('\n');

  const data = await sendToChat(TELEGRAM_TRICK_CHAT_ID, message);
  return data?.result?.message_id || null;
}

// ── Reply to existing message → trick channel ───────────
async function sendTrickReply(replyToMessageId, text) {
  const data = await sendToChat(TELEGRAM_TRICK_CHAT_ID, text, replyToMessageId);
  return data?.result?.message_id || null;
}

// ── Death Overs Wicket alert → trick channel ────────────
async function sendDeathOversWicketAlert({ matchLabel, battingTeam, runs, wickets, overs, target, firstInningsRuns, firstInningsWickets, matchInfo }) {
  const runsNeeded = target ? target - runs : null;
  const oversLeft  = (20 - overs).toFixed(1);

  const fullNames = (matchInfo && matchInfo.teamAFull && matchInfo.teamBFull)
    ? `${matchInfo.teamAFull} vs ${matchInfo.teamBFull}`
    : matchLabel;

  const lines = [
    `💀 *DEATH OVERS — 4 WKTS DOWN*`,
    `*${battingTeam}*  ·  *${runs}/${wickets}* (${overs} ov)`,
    `🏐 ${fullNames}`,
    `${matchLabel}  ·  2nd Inn`,
  ];

  if (target) {
    lines.push(`🎯 Target *${target}*  ·  Need *${runsNeeded}* off *${oversLeft} ov*`);
  }

  lines.push(
    ``,
    `⚡ 4 wickets down after 16 overs`,
    contextFooter(matchInfo),
    `⏰ ${getISTTime()}`,
    ``,
    `🔗 ${quickLinks()}`,
  );

  const message = lines.filter(l => l !== null).join('\n');
  const data = await sendToChat(TELEGRAM_TRICK_CHAT_ID, message);
  return data;
}

// ── Test mode scoreboard ────────────────────────────────
async function sendTestScoreSummary(liveMatches) {
  let message = `🧪 *TEST — Live Scores*\n⏰ ${getISTTime()}\n\n`;

  for (const match of liveMatches) {
    message += `*${match.label}*\n📊 ${match.score}`;
    if (match.seriesName) message += `\n🏆 ${match.seriesName}`;
    if (match.venue) message += `\n📍 ${match.venue}`;
    if (match.status) message += `\n📌 ${match.status}`;
    message += '\n\n';
  }

  await sendToChat(TELEGRAM_CHAT_ID, message);
}

module.exports = {
  initTelegram,
  sendTelegramAlert,
  sendTelegramReply,
  sendTrickReply,
  sendTrickNotifyAlert,
  sendSecondOverWicketAlert,
  sendDeathOversWicketAlert,
  sendTestScoreSummary
};
