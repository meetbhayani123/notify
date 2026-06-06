/**
 * helpers/matchFilter.js
 * Determines whether a match is live and worth monitoring.
 * Also builds enriched labels with tournament, full team names, and venue.
 * Provides series muting logic to suppress notifications for unwanted tournaments.
 */

const { resolveTeamName, resolveMatchInfo } = require('../api/teamResolver');
const Series = require('../db/models/Series');
const mongoose = require('mongoose');
const logger = require('../lib/logger');

// In-memory cache for muted series keys (refreshed every 60s)
let mutedSeriesCache = new Set();
let mutedCacheLastRefresh = 0;
const MUTED_CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Refresh the muted series cache from MongoDB.
 * Called before each poll cycle.
 */
async function refreshMutedSeriesCache() {
  const now = Date.now();
  if (now - mutedCacheLastRefresh < MUTED_CACHE_TTL_MS) return;

  if (mongoose.connection.readyState !== 1) return;

  try {
    const mutedSeries = await Series.find({ muted: true }, { f_key: 1 }).lean();
    mutedSeriesCache = new Set(mutedSeries.map(s => s.f_key));
    mutedCacheLastRefresh = now;
  } catch (err) {
    logger.error('Failed to refresh muted series cache:', err);
  }
}

/**
 * Check if a match belongs to a muted series.
 * Uses the match's `q` field (series key, prefixed with `^`).
 *
 * @param {object} match — raw match object from the API
 * @returns {boolean} true if the series is muted
 */
function isSeriesMuted(match) {
  if (!match.q) return false;
  const seriesKey = match.q.replace(/^\^/, '');
  return mutedSeriesCache.has(seriesKey);
}

// The user requested to monitor ALL matches, not just T20s.
const SUSPENDED_KEYWORDS = [
  'stumps', 'tea break', 'tea', 'lunch',
  'drinks', 'rain', 'bad light',
  'match abandoned', 'no result'
];
// Note: Removed "innings break" from suspended keywords because the user
// noticed the RCB vs PBKS match disappeared during the innings break.
// Note: Removed "toss delayed" — the API can keep stale "Toss Delayed" in
// the res field even after the match has started and has live score data.
// The score-data check below handles this safely.

/**
 * Returns true if the match is live and should be monitored.
 *
 * @param {object} match – raw match object from the API
 * @returns {boolean}
 */
function isLiveMatch(match) {
  // Must be live (d=1) or recently finished/innings break (d=2)
  if (match.d !== 1 && match.d !== 2) return false;

  // If the match already has score data, it's clearly in progress —
  // don't filter it out even if the res field has a stale status.
  if (match.j || match.k) return true;

  // No score data yet — check for suspended states
  if (match.res && typeof match.res === 'string') {
    const lower = match.res.toLowerCase();
    for (const kw of SUSPENDED_KEYWORDS) {
      if (lower.includes(kw)) return false;
    }
  }

  return true;
}

/**
 * Build a human-readable label for a match.
 * Uses short team names for compact display.
 *
 * @param {string} matchId
 * @param {object} match
 * @returns {Promise<string>} e.g. "[T20I] RCB vs PBKS (id: 1196)"
 */
async function matchLabel(matchId, match) {
  const format = match.fo || 'Match';
  const teamA = await resolveTeamName(match.b);
  const teamB = await resolveTeamName(match.c);
  return `[${format}] ${teamA} vs ${teamB} (id: ${matchId})`;
}

/**
 * Build an enriched label with tournament, full team names, and venue.
 * Used in Telegram notifications for maximum context.
 *
 * @param {string} matchId
 * @param {object} match – raw match object from the API
 * @returns {Promise<object>} { label, matchInfo }
 *   - label: compact "[T20] RCB vs PBKS (id: xxx)" string
 *   - matchInfo: { teamAShort, teamBShort, teamAFull, teamBFull, seriesName, seriesShortName, venue, format }
 */
async function enrichedMatchLabel(matchId, match) {
  const matchInfo = await resolveMatchInfo(match);
  const label = `[${matchInfo.format}] ${matchInfo.teamAShort} vs ${matchInfo.teamBShort} (id: ${matchId})`;
  return { label, matchInfo };
}

module.exports = { isLiveMatch, isSeriesMuted, refreshMutedSeriesCache, matchLabel, enrichedMatchLabel };
