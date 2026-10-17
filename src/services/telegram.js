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

/**
 * Escape the characters that legacy Telegram Markdown treats as formatting.
 * Player, team, series and venue names come from an upstream feed, and a stray
 * "_" or "*" makes Telegram reject the whole message with HTTP 400.
 */
function escapeMarkdown(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/([_*[\]`])/g, '\\$1');
}

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
  if (matchInfo.seriesName) parts.push(`🏆 ${escapeMarkdown(matchInfo.seriesName)}`);
  if (matchInfo.venue)      parts.push(`📍 ${escapeMarkdown(matchInfo.venue)}`);
  return parts.length > 0 ? '\n' + parts.join('\n') : '';
}

/** Quick-links one-liner. Includes CREX match link when available. */
function quickLinks(matchUrl) {
  const links = [];
  if (matchUrl) links.push(`[CREX](${matchUrl})`);
  links.push(`[CBTF](https://cbtffreehit.com/sport/in-play)`);
  links.push(`[USDT](https://usdtplayer.com/sport/4)`);
  return links.join('  ·  ');
}

/** "Australia Champions vs West Indies Champions", falling back to the label. */
function fullTeamNames(matchLabel, matchInfo) {
  return (matchInfo && matchInfo.teamAFull && matchInfo.teamBFull)
    ? `${escapeMarkdown(matchInfo.teamAFull)} vs ${escapeMarkdown(matchInfo.teamBFull)}`
    : matchLabel;
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
  const matchUrl = matchInfo?.matchUrl || null;

  const message = [
    `🚨 *1ST OVER WICKET!*`,
    `*${battingTeam}*  ·  *${runs}/${newWickets}* (${overs} ov)`,
    `🏐 ${fullTeamNames(matchLabel, matchInfo)}`,
    `${matchLabel}  ·  ${innTag(innings)}`,
    ``,
    `⚡ Wicket fell in the 1st over`,
    contextFooter(matchInfo),
    `⏰ ${getISTTime()}`,
    ``,
    `🔗 ${quickLinks(matchUrl)}`,
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
  const matchUrl = matchInfo?.matchUrl || null;

  const message = [
    `📈 *1ST OVER RUNS — TRICK*`,
    `*${battingTeam}* scored *${runs} runs* in 1st over`,
    `🏐 ${fullTeamNames(matchLabel, matchInfo)}`,
    `${matchLabel}  ·  ${innTag(innings)}`,
    `🎯 Target ≥ ${threshold} runs`,
    contextFooter(matchInfo),
    `⏰ ${getISTTime()}`,
    ``,
    `🔗 ${quickLinks(matchUrl)}`,
  ].filter(l => l !== null).join('\n');

  const data = await sendToChat(TELEGRAM_TRICK_CHAT_ID, message);
  return data;
}

// ── Death Overs Wicket alert → trick channel ────────────
async function sendDeathOversWicketAlert({ matchLabel, battingTeam, runs, wickets, overs, target, firstInningsRuns, firstInningsWickets, matchInfo }) {
  const runsNeeded = target ? target - runs : null;
  const oversLeft  = (20 - overs).toFixed(1);
  const matchUrl   = matchInfo?.matchUrl || null;

  const lines = [
    `💀 *DEATH OVERS — 4 WKTS DOWN*`,
    `*${battingTeam}*  ·  *${runs}/${wickets}* (${overs} ov)`,
    `🏐 ${fullTeamNames(matchLabel, matchInfo)}`,
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
    `🔗 ${quickLinks(matchUrl)}`,
  );

  const message = lines.filter(l => l !== null).join('\n');
  const data = await sendToChat(TELEGRAM_TRICK_CHAT_ID, message);
  return data;
}

// ── Scorecard tricks → trick channel ────────────────────
/**
 * Generic sender for the scorecard-derived tricks (captain / keeper / openers).
 * The calling strategy supplies the headline and the detail lines; the layout,
 * context footer and quick links are shared with every other alert.
 *
 * @param {object} alert
 * @param {string} alert.title        — e.g. "👑 *CAPTAIN TOP SCORER*"
 * @param {string} alert.headline     — second line, the notification preview
 * @param {string[]} alert.detailLines — body lines, already Markdown-escaped
 * @returns {Promise<number|null>} the sent message id
 */
async function sendScorecardTrickAlert({ title, headline, detailLines = [], matchLabel, innings, matchInfo }) {
  const matchUrl = matchInfo?.matchUrl || null;

  const footer = contextFooter(matchInfo);

  const lines = [
    title,
    headline,
    `🏐 ${fullTeamNames(matchLabel, matchInfo)}`,
    `${matchLabel}  ·  ${innTag(innings)}`,
    ``,
    ...detailLines.filter(Boolean),
    ...(footer ? [footer] : []),
    `⏰ ${getISTTime()}`,
    ``,
    `🔗 ${quickLinks(matchUrl)}`,
  ];

  const message = lines.join('\n');
  const data = await sendToChat(TELEGRAM_TRICK_CHAT_ID, message);
  return data?.result?.message_id || null;
}

// ── Test mode scoreboard ────────────────────────────────
async function sendTestScoreSummary(liveMatches) {
  let message = `🧪 *TEST — Live Scores*\n⏰ ${getISTTime()}\n\n`;

  for (const match of liveMatches) {
    message += `*${match.label}*\n📊 ${match.score}`;
    if (match.seriesName) message += `\n🏆 ${escapeMarkdown(match.seriesName)}`;
    if (match.venue) message += `\n📍 ${escapeMarkdown(match.venue)}`;
    if (match.status) message += `\n📌 ${match.status}`;
    message += '\n\n';
  }

  await sendToChat(TELEGRAM_CHAT_ID, message);
}

module.exports = {
  initTelegram,
  escapeMarkdown,
  sendTelegramAlert,
  sendTelegramReply,
  sendTrickNotifyAlert,
  sendDeathOversWicketAlert,
  sendScorecardTrickAlert,
  sendTestScoreSummary
};
