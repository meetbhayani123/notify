/**
 * core/server.js
 * Express health check server for Render deployment.
 * Also hosts the Series management API used by the frontend.
 */

const express = require('express');
const { PORT, TEST_MODE } = require('../config');
const seriesRoutes = require('../api/seriesRoutes');
const logger = require('../lib/logger');

function startServer() {
  const app = express();

  // ── Middleware ───────────────────────────────────────────
  app.use(express.json());

  // CORS — allow the Vercel frontend to call these APIs
  app.use((req, res, next) => {
    const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.origin;

    if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // ── Simple API key auth for write endpoints ─────────────
  app.use('/api', (req, res, next) => {
    // GET requests are open (read-only), write requests need API key
    if (req.method === 'GET') return next();

    const apiKey = process.env.API_KEY;
    if (!apiKey) return next(); // No API key configured → allow all

    const provided = req.headers['x-api-key'];
    if (provided !== apiKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
  });

  // ── Routes ──────────────────────────────────────────────
  app.get('/', (req, res) => res.send('Cricket Wicket Alert System is running!'));

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      mode: TEST_MODE ? 'TEST_MODE' : 'PRODUCTION'
    });
  });

  // Series management API
  app.use('/api/series', seriesRoutes);

  app.listen(PORT, () => {
    logger.info(`🌐 Health check server listening on port ${PORT}`);
  });
}

module.exports = { startServer };
