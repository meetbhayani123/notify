/**
 * api/scorecard.js
 * Fetches the full scorecard for a single match from the GoScorer API.
 *
 * This is the endpoint the CREX match-scorecard page itself calls:
 *   GET https://api.goscorer.com/api/v3/getSC4?key=<matchId>
 * It needs no authorization header, unlike getLiveMatches.
 *
 * Results are cached per match for SCORECARD_CACHE_TTL_MS so that repeated
 * poll ticks never hammer the API. Never throws — returns null on any error
 * so the poll loop keeps running.
 */

const axios = require('axios');
const { SCORECARD_API_URL, SCORECARD_CACHE_TTL_MS } = require('../config');
const { parseScorecard } = require('../helpers/scorecardParser');
const logger = require('../lib/logger');

// matchId → { innings, fetchedAt }
const cache = new Map();
// matchId → in-flight promise, so concurrent callers share one request
const inFlight = new Map();

async function requestScorecard(matchId) {
  const response = await axios.get(SCORECARD_API_URL, {
    params: { key: matchId },
    timeout: 8000,
    headers: {
      'origin':     'https://crex.com',
      'referer':    'https://crex.com/',
      'accept':     'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36'
    }
  });
  return parseScorecard(response.data);
}

/**
 * Fetch (or serve from cache) the parsed scorecard for a match.
 *
 * @param {string} matchId
 * @param {object} [opts]
 * @param {boolean} [opts.force] — bypass the TTL cache
 * @returns {Promise<Array<object>|null>} parsed innings, or null
 */
async function getScorecard(matchId, { force = false } = {}) {
  const cached = cache.get(matchId);
  if (!force && cached && Date.now() - cached.fetchedAt < SCORECARD_CACHE_TTL_MS) {
    return cached.innings;
  }

  // Share a single request between concurrent callers for the same match.
  const pending = inFlight.get(matchId);
  if (pending) return pending;

  const promise = requestScorecard(matchId)
    .then((innings) => {
      if (innings) cache.set(matchId, { innings, fetchedAt: Date.now() });
      return innings;
    })
    .catch((err) => {
      if (err.response) {
        logger.warn(`Scorecard API HTTP ${err.response.status} for match ${matchId}`);
      } else {
        logger.warn(`Scorecard API error for match ${matchId} — ${err.message}`);
      }
      return null;
    })
    .finally(() => {
      inFlight.delete(matchId);
    });

  inFlight.set(matchId, promise);
  return promise;
}

/**
 * Drop cached scorecards for matches that are no longer live.
 * @param {string[]} activeMatchIds
 */
function pruneScorecardCache(activeMatchIds) {
  const active = new Set(activeMatchIds);
  for (const matchId of cache.keys()) {
    if (!active.has(matchId)) cache.delete(matchId);
  }
}

module.exports = { getScorecard, pruneScorecardCache };
