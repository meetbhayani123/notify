/**
 * lib/logger.js
 * Centralized premium logger with ANSI colors and descriptive emojis.
 *
 * Every level prints to the console. Only the levels in LOG_PERSIST_LEVELS are
 * also written to MongoDB, and those expire on a TTL index — see
 * db/models/SystemLog.js. Persisting every line turned out to cost roughly one
 * insert per log statement on a two-second poll loop, which is how the
 * collection reached 1.6M documents and 96% of the database.
 */

const { LOG_PERSIST_LEVELS, LOG_MAX_ERROR_CHARS } = require('../config');

const PERSISTED_LEVELS = new Set(LOG_PERSIST_LEVELS);

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",

  fgRed: "\x1b[31m",
  fgGreen: "\x1b[32m",
  fgYellow: "\x1b[33m",
  fgBlue: "\x1b[34m",
  fgMagenta: "\x1b[35m",
  fgCyan: "\x1b[36m",
};

function getTimestamp() {
  return new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// Lazy-loaded to avoid circular dependency at startup
let _SystemLog = null;
let _isDbConnected = null;

function saveToDb(level, message, error = null) {
  // Checked first: a level we do not keep must not cost a require, a
  // connection check or a round trip.
  if (!PERSISTED_LEVELS.has(level)) return;

  try {
    if (!_SystemLog) _SystemLog = require('../db/models/SystemLog');
    if (!_isDbConnected) _isDbConnected = require('../db/connection').isDbConnected;
  } catch { return; }

  if (!_isDbConnected()) return;

  let errorDetails = null;
  if (error) {
    errorDetails = String(error.stack || error.message || error).slice(0, LOG_MAX_ERROR_CHARS);
  }
  _SystemLog.create({ level, message, errorDetails }).catch(() => {});
}

const logger = {
  info: (msg) => {
    console.log(`[${getTimestamp()}] ℹ️  ${colors.fgBlue}[INFO]${colors.reset} ${msg}`);
    saveToDb('INFO', msg);
  },

  success: (msg) => {
    console.log(`[${getTimestamp()}] ✅ ${colors.fgGreen}${colors.bright}[SUCCESS]${colors.reset} ${msg}`);
    saveToDb('SUCCESS', msg);
  },

  warn: (msg) => {
    console.warn(`[${getTimestamp()}] ⚠️  ${colors.fgYellow}[WARN]${colors.reset} ${msg}`);
    saveToDb('WARN', msg);
  },

  error: (msg, err = '') => {
    const errMsg = err ? ` — ${err.message || err}` : '';
    console.error(`[${getTimestamp()}] ❌ ${colors.fgRed}${colors.bright}[ERROR]${colors.reset} ${msg}${errMsg}`);
    saveToDb('ERROR', `${msg}${errMsg}`, err);
  },

  live: (msg) => {
    console.log(`[${getTimestamp()}] 🔍 ${colors.fgCyan}${colors.bright}[LIVE TRACKING]${colors.reset} ${msg}`);
    saveToDb('LIVE', msg);
  },

  db: (msg) => {
    console.log(`[${getTimestamp()}] 💾 ${colors.fgMagenta}[DATABASE]${colors.reset} ${msg}`);
    saveToDb('DATABASE', msg);
  }
};

module.exports = logger;
