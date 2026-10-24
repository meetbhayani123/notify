/**
 * api/overHistory.js
 * Fetches the per-over history for a single match from the GoScorer API.
 *
 * This is the endpoint the CREX live-score page itself calls:
 *   GET https://api.goscorer.com/api/v3/getSV3?key=<matchId>
 * It needs no authorization header, like getSC4 and unlike getLiveMatches.
 *
 * The response carries a rolling window of the most recent overs, which the
 * live-matches feed does not provide at all. Callers only ask for it when an
 * over has just completed, so this stays at roughly one request per over per
 * live match. Never throws — returns null on any error.
 */

const axios = require('axios');
const { MATCH_STATE_API_URL, OVER_HISTORY_CACHE_TTL_MS } = require('../config');
const { parseOverHistory } = require('../helpers/overParser');
const logger = require('../lib/logger');

// matchId → { history, secondInningsStarted, fetchedAt }
const cache = new Map();
const inFlight = new Map();

async function requestOverHistory(matchId) {
  const response = await axios.get(MATCH_STATE_API_URL, {
    params: { key: matchId },
    timeout: 8000,
    headers: {
      'origin':     'https://crex.com',
      'referer':    'https://crex.com/',
      'accept':     'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36'
    }
  });

  const data = response.data || {};
  return {
    history: parseOverHistory(data.rb),
    // `k` is the 2nd innings score; its presence means the chase is under way.
    secondInningsStarted: typeof data.k === 'string' && data.k.length > 0
  };
}

/**
 * Fetch (or serve from cache) the parsed over history for a match.
 *
 * @param {string} matchId
 * @param {object} [opts]
 * @param {boolean} [opts.force] — bypass the TTL cache
 * @returns {Promise<{history: Array, secondInningsStarted: boolean}|null>}
 */
async function getOverHistory(matchId, { force = false } = {}) {
  const cached = cache.get(matchId);
  if (!force && cached && Date.now() - cached.fetchedAt < OVER_HISTORY_CACHE_TTL_MS) {
    return cached;
  }

  const pending = inFlight.get(matchId);
  if (pending) return pending;

  const promise = requestOverHistory(matchId)
    .then((result) => {
      const entry = { ...result, fetchedAt: Date.now() };
      cache.set(matchId, entry);
      return entry;
    })
    .catch((err) => {
      if (err.response) {
        logger.warn(`Match state API HTTP ${err.response.status} for match ${matchId}`);
      } else {
        logger.warn(`Match state API error for match ${matchId} — ${err.message}`);
      }
      return null;
    })
    .finally(() => inFlight.delete(matchId));

  inFlight.set(matchId, promise);
  return promise;
}

/**
 * Drop cached history for matches that are no longer live.
 */
function pruneOverHistoryCache(activeMatchIds) {
  const active = new Set(activeMatchIds);
  for (const matchId of cache.keys()) {
    if (!active.has(matchId)) cache.delete(matchId);
  }
}

module.exports = { getOverHistory, pruneOverHistoryCache };
