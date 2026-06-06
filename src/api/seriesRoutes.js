/**
 * api/seriesRoutes.js
 * REST API routes for managing series (tournaments).
 * Used by the Next.js frontend to list, mute, and unmute series.
 */

const express = require('express');
const Series = require('../db/models/Series');
const logger = require('../lib/logger');

const router = express.Router();

/**
 * GET /api/series
 * Returns all series sorted by name, with muted status.
 */
router.get('/', async (req, res) => {
  try {
    const series = await Series.find({}).sort({ name: 1 }).lean();
    res.json({ success: true, data: series });
  } catch (err) {
    logger.error('Failed to fetch series list:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch series' });
  }
});

/**
 * PATCH /api/series/:fKey/mute
 * Mute a series — notifications for matches in this series will be skipped.
 */
router.patch('/:fKey/mute', async (req, res) => {
  try {
    const { fKey } = req.params;
    const series = await Series.findOneAndUpdate(
      { f_key: fKey },
      { $set: { muted: true } },
      { returnDocument: 'after' }
    );
    if (!series) {
      return res.status(404).json({ success: false, error: 'Series not found' });
    }
    logger.info(`🔇 Series muted: "${series.name}" (${fKey})`);
    res.json({ success: true, data: series });
  } catch (err) {
    logger.error(`Failed to mute series ${req.params.fKey}:`, err);
    res.status(500).json({ success: false, error: 'Failed to mute series' });
  }
});

/**
 * PATCH /api/series/:fKey/unmute
 * Unmute a series — notifications will resume for matches in this series.
 */
router.patch('/:fKey/unmute', async (req, res) => {
  try {
    const { fKey } = req.params;
    const series = await Series.findOneAndUpdate(
      { f_key: fKey },
      { $set: { muted: false } },
      { returnDocument: 'after' }
    );
    if (!series) {
      return res.status(404).json({ success: false, error: 'Series not found' });
    }
    logger.info(`🔊 Series unmuted: "${series.name}" (${fKey})`);
    res.json({ success: true, data: series });
  } catch (err) {
    logger.error(`Failed to unmute series ${req.params.fKey}:`, err);
    res.status(500).json({ success: false, error: 'Failed to unmute series' });
  }
});

/**
 * PATCH /api/series/bulk-mute
 * Bulk mute or unmute multiple series.
 * Body: { fKeys: string[], muted: boolean }
 */
router.patch('/bulk-mute', async (req, res) => {
  try {
    const { fKeys, muted } = req.body;
    if (!Array.isArray(fKeys) || typeof muted !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Invalid request body. Expected { fKeys: string[], muted: boolean }' });
    }

    const result = await Series.updateMany(
      { f_key: { $in: fKeys } },
      { $set: { muted } }
    );

    const action = muted ? 'muted' : 'unmuted';
    logger.info(`🔇 Bulk ${action}: ${result.modifiedCount} series`);
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    logger.error('Failed to bulk mute/unmute series:', err);
    res.status(500).json({ success: false, error: 'Failed to bulk update series' });
  }
});

module.exports = router;
