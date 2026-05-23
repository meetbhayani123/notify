/**
 * logger.js
 * Centralized premium logger with ANSI colors and descriptive emojis.
 * Dynamically pushes logs to MongoDB asynchronously without blocking the loop.
 */

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  
  fgBlack: "\x1b[30m",
  fgRed: "\x1b[31m",
  fgGreen: "\x1b[32m",
  fgYellow: "\x1b[33m",
  fgBlue: "\x1b[34m",
  fgMagenta: "\x1b[35m",
  fgCyan: "\x1b[36m",
  fgWhite: "\x1b[37m"
};

function getTimestamp() {
  return new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
}

let dbModule = null;
function getDb() {
  if (!dbModule) {
    try {
      dbModule = require('./stateManager');
    } catch (err) {
      // ignore
    }
  }
  return dbModule;
}

const logger = {
  info: (msg) => {
    console.log(`[${getTimestamp()}] ℹ️  ${colors.fgBlue}[INFO]${colors.reset} ${msg}`);
    const db = getDb();
    if (db) db.saveSystemLog('INFO', msg).catch(() => {});
  },
  
  success: (msg) => {
    console.log(`[${getTimestamp()}] ✅ ${colors.fgGreen}${colors.bright}[SUCCESS]${colors.reset} ${msg}`);
    const db = getDb();
    if (db) db.saveSystemLog('SUCCESS', msg).catch(() => {});
  },
  
  warn: (msg) => {
    console.warn(`[${getTimestamp()}] ⚠️  ${colors.fgYellow}[WARN]${colors.reset} ${msg}`);
    const db = getDb();
    if (db) db.saveSystemLog('WARN', msg).catch(() => {});
  },
  
  error: (msg, err = '') => {
    const errMsg = err ? ` — ${err.message || err}` : '';
    console.error(`[${getTimestamp()}] ❌ ${colors.fgRed}${colors.bright}[ERROR]${colors.reset} ${msg}${errMsg}`);
    const db = getDb();
    if (db) db.saveSystemLog('ERROR', `${msg}${errMsg}`, err).catch(() => {});
  },
  
  live: (msg) => {
    console.log(`[${getTimestamp()}] 🔍 ${colors.fgCyan}${colors.bright}[LIVE TRACKING]${colors.reset} ${msg}`);
    const db = getDb();
    if (db) db.saveSystemLog('LIVE', msg).catch(() => {});
  },
  
  db: (msg) => {
    console.log(`[${getTimestamp()}] 💾 ${colors.fgMagenta}[DATABASE]${colors.reset} ${msg}`);
    const db = getDb();
    if (db) db.saveSystemLog('DATABASE', msg).catch(() => {});
  }
};

module.exports = logger;
