/**
 * helpers/matchFilter.js
 * Determines whether a match is live and worth monitoring.
 */

const { resolveTeamName } = require('../api/teamResolver');

// The user requested to monitor ALL matches, not just T20s.
const SUSPENDED_KEYWORDS = [
  'stumps', 'tea break', 'tea', 'lunch',
  'drinks', 'rain', 'bad light', 'toss delayed',
  'match abandoned', 'no result'
];
// Note: Removed "innings break" from suspended keywords because the user
// noticed the RCB vs PBKS match disappeared during the innings break.

/**
 * Returns true if the match is live and should be monitored.
 *
 * @param {object} match – raw match object from the API
 * @returns {boolean}
 */
function isLiveMatch(match) {
  // Must be live (d=1) or recently finished/innings break (d=2)
  if (match.d !== 1 && match.d !== 2) return false;

  // Must not be in a suspended state (except innings break)
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

module.exports = { isLiveMatch, matchLabel };
