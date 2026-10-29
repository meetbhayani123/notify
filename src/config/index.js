/**
 * config/index.js
 * Single source of truth for all application configuration.
 * Exports validated constants derived from process.env.
 * NOTE: dotenv must be loaded before this module is required.
 */

// ── Polling ─────────────────────────────────────────────
const POLL_INTERVAL_MS = Math.max(
  parseInt(process.env.POLL_INTERVAL_MS, 10) || 2000,
  1000
);
const MAX_POLL_INTERVAL_MS = 30000;

// ── Modes ───────────────────────────────────────────────
const TEST_MODE = process.env.TEST_MODE === 'true';
const TEST_SEND_EVERY = 15;

// ── Match Finished Detection ────────────────────────────
const MATCH_FINISHED_KEYWORDS = [
  'won by', 'won the', 'tied', 'draw', 'drawn',
  'abandoned', 'no result', 'super over',
  'dls', 'd/l', 'concede', 'forfeited'
];

// ── T20 Format Detection ────────────────────────────────
const T20_FORMAT_KEYWORDS = [
  't20', 'ipl', 'hundred', 'bbl', 'cpl', 'psl', 'wpl', 't-20'
];

// ── ODI Format Detection ────────────────────────────────
const ODI_FORMAT_KEYWORDS = [
  'odi', 'one day', 'one-day', 'oneday', 'list a'
];

// ── Trick Thresholds ────────────────────────────────────
const FIRST_OVER_RUNS_THRESHOLD = { 1: 14, 2: 13 };
const WICKET_TRICK_MAX_BALLS = 24;
const DEATH_OVERS_WICKET_MIN_OVERS = 16.0;
const DEATH_OVERS_WICKET_EXACT_WICKETS = 4;

// ── Scorecard Trick Thresholds ──────────────────────────
// Openers trick (ODI): a strike rate of 101+ counts as "over 100".
const OPENER_HIGH_SR_MIN = 101;
// Captain cheap-dismissal trick (T20): under 100 SR off 10 or more balls.
const CAPTAIN_CHEAP_MAX_SR = 100;
const CAPTAIN_CHEAP_MIN_BALLS = 10;

// ── Tight Over Wicket Trick (T20, 2nd innings) ──────────
// A wicket in an over that went for this many runs or fewer.
const TIGHT_OVER_MAX_RUNS = 5;

// ── Scorecard API ───────────────────────────────────────
const SCORECARD_API_URL = process.env.SCORECARD_API_URL
  || 'https://api.goscorer.com/api/v3/getSC4';
const PLAYER_MAP_API_URL = process.env.PLAYER_MAP_API_URL
  || 'https://oc.crickapi.com/mapping/getHomeMapData';
// Per-match scorecard cache, so repeated polls never hammer the API.
const SCORECARD_CACHE_TTL_MS = 20_000;

// Per-over history, from the same match-state endpoint the live page uses.
const MATCH_STATE_API_URL = process.env.MATCH_STATE_API_URL
  || 'https://api.goscorer.com/api/v3/getSV3';
const OVER_HISTORY_CACHE_TTL_MS = 8_000;

// ── Logging ─────────────────────────────────────────────
// Only these levels are written to MongoDB; every level still prints to the
// console. INFO / LIVE / DATABASE are deliberately absent: they are per-poll
// chatter that costs an insert each and is never read back.
// Set LOG_PERSIST_LEVELS to an empty string to stop persisting logs entirely.
const LOG_PERSIST_LEVELS = (process.env.LOG_PERSIST_LEVELS ?? 'ERROR,WARN,SUCCESS')
  .split(',')
  .map(level => level.trim().toUpperCase())
  .filter(Boolean);

// MongoDB expires a persisted log once it reaches this age, so the collection
// cannot grow without bound again.
// NOTE: changing this after the TTL index exists needs the index dropped (or a
// collMod) — MongoDB will not silently alter an index's expiry.
const LOG_RETENTION_DAYS = Math.max(1, parseInt(process.env.LOG_RETENTION_DAYS, 10) || 30);

// Keeps one bad stack trace from ballooning a single document.
const LOG_MAX_ERROR_CHARS = 2000;

// ── Telegram ────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_TRICK_CHAT_ID = process.env.TELEGRAM_TRICK_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

// ── Server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// ── Env Validation ──────────────────────────────────────
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
  if (process.env.CRICKET_API_JWT === 'your_jwt_token_here') {
    console.error('❌ CRICKET_API_JWT is still a placeholder — update .env');
    process.exit(1);
  }
}

module.exports = {
  POLL_INTERVAL_MS,
  MAX_POLL_INTERVAL_MS,
  TEST_MODE,
  TEST_SEND_EVERY,
  MATCH_FINISHED_KEYWORDS,
  T20_FORMAT_KEYWORDS,
  ODI_FORMAT_KEYWORDS,
  FIRST_OVER_RUNS_THRESHOLD,
  WICKET_TRICK_MAX_BALLS,
  DEATH_OVERS_WICKET_MIN_OVERS,
  DEATH_OVERS_WICKET_EXACT_WICKETS,
  OPENER_HIGH_SR_MIN,
  CAPTAIN_CHEAP_MAX_SR,
  CAPTAIN_CHEAP_MIN_BALLS,
  TIGHT_OVER_MAX_RUNS,
  SCORECARD_API_URL,
  PLAYER_MAP_API_URL,
  SCORECARD_CACHE_TTL_MS,
  MATCH_STATE_API_URL,
  OVER_HISTORY_CACHE_TTL_MS,
  LOG_PERSIST_LEVELS,
  LOG_RETENTION_DAYS,
  LOG_MAX_ERROR_CHARS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_TRICK_CHAT_ID,
  PORT,
  validateEnv
};
