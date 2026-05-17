/**
 * index.js — Cricket Wicket Alert System
 * Entry point: starts WhatsApp client, then polls the cricket API
 * every N seconds looking for first-over wickets in live T20 matches.
 *
 * TEST_MODE=true  → sends live scoreboard to group every 30s
 * TEST_MODE=false → production mode, only first-over wicket alerts
 */

require('dotenv').config();

const { fetchLiveMatches }                        = require('./poller');
const { isLiveMatch, matchLabel }                 = require('./matchFilter');
const { parseScore, getCurrentInningsScore }      = require('./scoreParser');
const { initDB, checkForWicket }                  = require('./stateManager');
const { initTelegram, sendTelegramAlert, sendTestScoreSummary } = require('./notifier');
const express                                     = require('express');

// ── Config ──────────────────────────────────────────────
const POLL_INTERVAL = Math.max(
  parseInt(process.env.POLL_INTERVAL_MS, 10) || 2000,
  1000
);
const TEST_MODE = process.env.TEST_MODE === 'true';

// In test mode, send a score summary every TEST_SEND_EVERY polls
// At 2s polling, 15 polls = every 30 seconds
const TEST_SEND_EVERY = 15;

let pollCount = 0;

// ── Env validation ──────────────────────────────────────
function validateEnv() {
  const required = [
    'CRICKET_API_URL',
    'CRICKET_API_JWT',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID'
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ Missing required .env variables:', missing.join(', '));
    process.exit(1);
  }

  // Check for obvious placeholder values
  if (process.env.CRICKET_API_JWT === 'your_jwt_token_here') {
    console.error('❌ CRICKET_API_JWT is still a placeholder — update .env');
    process.exit(1);
  }
}

// ── IST timestamp helper ────────────────────────────────
function ist() {
  return new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// ── Format a score string for display ───────────────────
function formatScore(match) {
  const parts = [];
  if (match.j) {
    const p = parseScore(match.j);
    if (p) parts.push(`${p.runs}/${p.wickets} (${p.overs} ov)`);
  }
  if (match.k) {
    const p = parseScore(match.k);
    if (p) parts.push(`${p.runs}/${p.wickets} (${p.overs} ov)`);
  }
  if (parts.length === 0) return 'Not started yet';
  if (parts.length === 1) return parts[0];
  return `${parts[0]}  vs  ${parts[1]}`;
}

// ── Single poll tick ────────────────────────────────────
async function tick() {
  pollCount++;
  const data = await fetchLiveMatches();
  if (!data) return;

  const matchIds    = Object.keys(data);
  let liveT20Count  = 0;
  const liveMatches = [];  // for test mode

  for (const id of matchIds) {
    const match = data[id];

    // ── Test mode: collect live matches with actual scores ──
    const isLive = isLiveMatch(match);
    if (TEST_MODE && isLive && (match.j || match.k)) {
      const label = matchLabel(id, match);
      const score = getCurrentInningsScore(match);
      liveMatches.push({
        label,
        score: formatScore(match),
        status: match.res || (score ? `${score.overs} ov bowled` : ''),
        currentScore: score
      });
    }

    // ── Production: process all live matches ───────────────────
    if (!isLive) continue;
    liveT20Count++;

    const score = getCurrentInningsScore(match);
    if (!score) continue;            // innings not started
    if (!score.isFirstOver) continue; // past the first over already

    const result = await checkForWicket(id, score);
    if (!result.wicketFell) continue;

    const label = matchLabel(id, match);
    console.log(
      `\n🚨 WICKET in 1st over! ${label} — ${score.runs}/${score.wickets} (${score.overs} ov)`
    );

    try {
      await sendTelegramAlert({
        matchLabel:  label,
        matchId:     id,
        prevWickets: result.prevWickets,
        newWickets:  result.newWickets,
        overs:       score.overs,
        runs:        score.runs
      });
    } catch (err) {
      console.error('❌ Telegram send failed:', err.message);
    }
  }

  // ── Test mode: send live scoreboard ──
  if (TEST_MODE && liveMatches.length > 0 && (pollCount === 1 || pollCount % TEST_SEND_EVERY === 0)) {
    try {
      await sendTestScoreSummary(liveMatches);
    } catch (err) {
      console.error('❌ [TEST] Telegram send failed:', err.message);
    }
  }

  // Summary log every 10 polls
  if (pollCount % 10 === 1) {
    console.log(
      `[${ist()}] Poll #${pollCount} — ${matchIds.length} total matches, ${liveT20Count} live tracked matches, ${liveMatches.length} with scores`
    );
  }
}

// ── Bootstrap ───────────────────────────────────────────
async function main() {
  validateEnv();

  const mode = TEST_MODE ? '🧪 TEST MODE' : '🏏 PRODUCTION';
  console.log(`${mode} — Cricket Wicket Alert System starting...`);
  console.log(`   Polling every ${POLL_INTERVAL / 1000}s`);
  if (TEST_MODE) {
    console.log(`   📢 Sending live scoreboard to group every ${TEST_SEND_EVERY * POLL_INTERVAL / 1000}s`);
  }
  console.log('   Watching: ALL live matches, first over wickets only');
  console.log(`   Alert to chat: "${process.env.TELEGRAM_CHAT_ID}"`);
  console.log('');

  // Initialise MongoDB
  await initDB();

  // ── Render Web Service Support (Dummy Server) ─────────
  const app = express();
  const port = process.env.PORT || 3000;
  app.get('/', (req, res) => res.send('Cricket Wicket Alert System is running!'));
  app.listen(port, () => {
    console.log(`🌐 Health check server listening on port ${port}`);
  });

  // Initialise Telegram
  await initTelegram();

  console.log('\n🟢 Telegram ready — starting poll loop...\n');

  // First tick immediately, then every POLL_INTERVAL
  tick();
  setInterval(tick, POLL_INTERVAL);
}

main().catch((err) => {
  console.error('💀 Fatal error:', err.message);
  process.exit(1);
});
