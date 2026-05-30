/**
 * index.js — Cricket Wicket Alert System
 * Slim bootstrap: validates config, connects services, and starts the poll loop.
 */

require('dotenv').config();

const { validateEnv, POLL_INTERVAL_MS, TEST_MODE, TEST_SEND_EVERY } = require('./config');
const { initDB } = require('./db/connection');
const { initTelegram } = require('./services/telegram');
const { initTeamResolver } = require('./api/teamResolver');
const { startServer } = require('./core/server');
const { startPollLoop } = require('./core/pollLoop');
const logger = require('./lib/logger');

async function main() {
  validateEnv();

  const mode = TEST_MODE ? '🧪 TEST MODE' : '🏏 PRODUCTION';
  logger.info(`${mode} — Cricket Wicket Alert System starting...`);
  logger.info(`Polling every ${POLL_INTERVAL_MS / 1000}s`);
  if (TEST_MODE) {
    logger.info(`Sending live scoreboard to group every ${TEST_SEND_EVERY * POLL_INTERVAL_MS / 1000}s`);
  }
  logger.info('Watching: ALL live matches, first over wickets only');
  logger.info(`Alert to chat: "${process.env.TELEGRAM_CHAT_ID}"`);

  // Initialise MongoDB
  const dbOk = await initDB();
  if (dbOk) {
    logger.success('Connected to MongoDB! Alert state will persist across restarts.');
  }

  // Load Team Name Mapping (Memory → MongoDB → CREX)
  await initTeamResolver();

  // Start Express health check server
  startServer();

  // Initialise Telegram
  await initTelegram();

  logger.success('Telegram ready — starting poll loop...');

  // Start the recursive tick loop
  startPollLoop();
}

main().catch((err) => {
  logger.error('Fatal error occurred during bootstrap', err);
  process.exit(1);
});
