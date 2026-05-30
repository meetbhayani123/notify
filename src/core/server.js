/**
 * core/server.js
 * Express health check server for Render deployment.
 */

const express = require('express');
const { PORT, TEST_MODE } = require('../config');
const logger = require('../lib/logger');

function startServer() {
  const app = express();

  app.get('/', (req, res) => res.send('Cricket Wicket Alert System is running!'));

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      mode: TEST_MODE ? 'TEST_MODE' : 'PRODUCTION'
    });
  });

  app.listen(PORT, () => {
    logger.info(`🌐 Health check server listening on port ${PORT}`);
  });
}

module.exports = { startServer };
