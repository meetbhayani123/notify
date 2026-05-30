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

// ── Trick Thresholds ────────────────────────────────────
const FIRST_OVER_RUNS_THRESHOLD = { 1: 14, 2: 13 };
const WICKET_TRICK_MAX_BALLS = 24;
const SECOND_OVER_WICKET_MAX_OVERS = 5.0;

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
  FIRST_OVER_RUNS_THRESHOLD,
  WICKET_TRICK_MAX_BALLS,
  SECOND_OVER_WICKET_MAX_OVERS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_TRICK_CHAT_ID,
  PORT,
  validateEnv
};
