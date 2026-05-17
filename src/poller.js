/**
 * poller.js
 * Fetches live match data from the GoScorer cricket API.
 * Never throws — returns null on any error so the poll loop continues.
 */

const axios = require('axios');

/**
 * Fetch all live matches from the GoScorer API.
 *
 * @returns {Promise<object|null>} the raw matches object, or null on error
 */
async function fetchLiveMatches() {
  try {
    const response = await axios.get(process.env.CRICKET_API_URL, {
      timeout: 8000,
      headers: {
        'authorization': process.env.CRICKET_API_JWT,
        'cc':            process.env.CRICKET_COUNTRY_CODE || 'IN',
        'origin':        'https://crex.com',
        'referer':       'https://crex.com/',
        'accept':        'application/json, text/plain, */*',
        'user-agent':    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36'
      }
    });

    return response.data;
  } catch (err) {
    if (err.response) {
      console.warn(`⚠️  API HTTP ${err.response.status} — ${err.response.statusText}`);
    } else if (err.code === 'ECONNABORTED') {
      console.warn('⚠️  API request timed out (8s)');
    } else {
      console.warn(`⚠️  API network error — ${err.message}`);
    }
    return null;
  }
}

module.exports = { fetchLiveMatches };
