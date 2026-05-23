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
const { initDB, checkForWicket, getMatchState, saveFirstOverSessionEvent }  = require('./stateManager');
const { initTelegram, sendTelegramAlert, sendTestScoreSummary } = require('./notifier');
const { initTeamResolver, resolveTeamName }        = require('./teamResolver');
const logger                                      = require('./logger');
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
      const label = await matchLabel(id, match);
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

    // Live Tracking Log for first over
    if (score.isFirstOver) {
      const label = await matchLabel(id, match);
      const battingTeam = await resolveTeamName(score.battingTeamKey);
      const dbState = await getMatchState(id);
      const notifiedStr = (dbState && dbState.notified) ? '✅ Alert Sent' : '⏳ Waiting for Wicket';
      logger.live(`${label} — Batting: ${battingTeam} (${score.innings === 1 ? '1st' : '2nd'} Innings) — ${score.runs}/${score.wickets} (${score.overs} ov) — [${notifiedStr}]`);

      // Save to MongoDB asynchronously (non-blocking)!
      saveFirstOverSessionEvent({
        matchId: id,
        matchLabel: label,
        innings: score.innings,
        battingTeam: battingTeam,
        score: score,
        notified: !!(dbState && dbState.notified),
        action: 'poll_received'
      }).catch(() => {});
    }

    const result = await checkForWicket(id, score);
    if (!result.wicketFell) continue;

    const label = await matchLabel(id, match);
    const battingTeam = await resolveTeamName(score.battingTeamKey);
    logger.success(
      `WICKET in 1st over! ${label} — Batting: ${battingTeam} (${score.innings === 1 ? '1st' : '2nd'} Innings) — ${score.runs}/${score.wickets} (${score.overs} ov)`
    );

    // Save alert trigger to history asynchronously (non-blocking)!
    saveFirstOverSessionEvent({
      matchId: id,
      matchLabel: label,
      innings: score.innings,
      battingTeam: battingTeam,
      score: score,
      notified: true,
      action: 'alert_triggered'
    }).catch(() => {});

    try {
      await sendTelegramAlert({
        matchLabel:  label,
        matchId:     id,
        prevWickets: result.prevWickets,
        newWickets:  result.newWickets,
        overs:       score.overs,
        runs:        score.runs,
        battingTeam: battingTeam,
        innings:     score.innings
      });
      logger.success(`Telegram alert sent successfully for ${label}`);

      // Save alert success to history asynchronously (non-blocking)!
      saveFirstOverSessionEvent({
        matchId: id,
        matchLabel: label,
        innings: score.innings,
        battingTeam: battingTeam,
        score: score,
        notified: true,
        action: 'alert_success',
        telegramStatus: 'SUCCESS'
      }).catch(() => {});
    } catch (err) {
      logger.error(`Telegram send failed for ${label}`, err);

      // Save alert failure to history asynchronously (non-blocking)!
      saveFirstOverSessionEvent({
        matchId: id,
        matchLabel: label,
        innings: score.innings,
        battingTeam: battingTeam,
        score: score,
        notified: true,
        action: 'alert_failed',
        telegramStatus: 'FAILED',
        telegramError: err
      }).catch(() => {});
    }
  }

  // ── Test mode: send live scoreboard ──
  if (TEST_MODE && liveMatches.length > 0 && (pollCount === 1 || pollCount % TEST_SEND_EVERY === 0)) {
    try {
      await sendTestScoreSummary(liveMatches);
      logger.success('Test live scoreboard sent successfully to Telegram');
    } catch (err) {
      logger.error('Test scoreboard Telegram send failed', err);
    }
  }

  // Summary log every 10 polls
  if (pollCount % 10 === 1) {
    logger.info(
      `Poll #${pollCount} — ${matchIds.length} total matches, ${liveT20Count} live tracked matches, ${liveMatches.length} with scores`
    );
  }
}

// ── Bootstrap ───────────────────────────────────────────
async function main() {
  validateEnv();

  const mode = TEST_MODE ? '🧪 TEST MODE' : '🏏 PRODUCTION';
  logger.info(`${mode} — Cricket Wicket Alert System starting...`);
  logger.info(`Polling every ${POLL_INTERVAL / 1000}s`);
  if (TEST_MODE) {
    logger.info(`Sending live scoreboard to group every ${TEST_SEND_EVERY * POLL_INTERVAL / 1000}s`);
  }
  logger.info('Watching: ALL live matches, first over wickets only');
  logger.info(`Alert to chat: "${process.env.TELEGRAM_CHAT_ID}"`);

  // Initialise MongoDB
  await initDB();

  // Load Team Name Mapping (Memory -> MongoDB -> CREX)
  await initTeamResolver();

  // ── Render Web Service Support (Dummy Server) ─────────
  const app = express();
  const port = process.env.PORT || 3000;
  
  // Basic root endpoint
  app.get('/', (req, res) => res.send('Cricket Wicket Alert System is running!'));
  
  // Dedicated JSON Health Check Endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      mode: TEST_MODE ? 'TEST_MODE' : 'PRODUCTION'
    });
  });

  app.listen(port, () => {
    logger.info(`🌐 Health check server listening on port ${port}`);
  });

  // Initialise Telegram
  await initTelegram();

  logger.success('Telegram ready — starting poll loop...');

  // First tick immediately, then every POLL_INTERVAL
  tick();
  setInterval(tick, POLL_INTERVAL);
}

main().catch((err) => {
  logger.error('Fatal error occurred during bootstrap', err);
  process.exit(1);
});
