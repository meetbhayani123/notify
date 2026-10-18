/**
 * helpers/scoreParser.js
 * Parses the compact score strings from the GoScorer API.
 *
 * Score format:  "runs/wickets(overs"
 *   - The closing bracket is intentionally absent in the raw API data.
 *   - Overs decimal part is the ball count (1–6), NOT a fraction.
 *     e.g. 7.2 = 7 full overs + 2 balls = 44 balls total.
 */

const SCORE_REGEX = /^(\d+)\/(\d+)\((\d+(?:\.\d+)?)/;

/**
 * Convert an overs value (e.g. 14.2) to total balls bowled.
 * @param {number} overs – decimal overs value
 * @returns {number} total balls
 */
function parseOversToTotalBalls(overs) {
  const fullOvers  = Math.floor(overs);
  const extraBalls = Math.round((overs - fullOvers) * 10);
  return fullOvers * 6 + extraBalls;
}

/**
 * Parse a raw score string from the API.
 *
 * @param {string|undefined} raw – e.g. "207/5(20.0" or "" or undefined
 * @returns {{ runs: number, wickets: number, overs: number, balls: number, isFirstOver: boolean } | null}
 */
function parseScore(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const m = raw.match(SCORE_REGEX);
  if (!m) return null;

  const runs    = parseInt(m[1], 10);
  const wickets = parseInt(m[2], 10);
  const overs   = parseFloat(m[3]);
  const balls   = parseOversToTotalBalls(overs);

  // "First over" means balls 1-6 (overs 0.1 through 1.0 or 0.6).
  // At 1.0 (or 0.6) the 6th ball has been bowled — the first over is complete.
  // At 1.1+ we're into the 2nd over or beyond.
  const isFirstOver = balls >= 1 && balls <= 6;

  return { runs, wickets, overs, balls, isFirstOver };
}

/**
 * Determine the *current live innings* score for a match.
 * If the 2nd innings has started (match.k is parseable) use that,
 * otherwise fall back to the 1st innings (match.j).
 *
 * @param {object} match – raw match object from the API
 * @returns {{ runs: number, wickets: number, overs: number, balls: number, isFirstOver: boolean } | null}
 */
function getCurrentInningsScore(match) {
  const second = parseScore(match.k);
  if (second) {
    return {
      ...second,
      innings: 2,
      battingTeamKey: match.c
    };
  }
  const first = parseScore(match.j);
  if (first) {
    return {
      ...first,
      innings: 1,
      battingTeamKey: match.b
    };
  }
  return null;
}

module.exports = { parseScore, getCurrentInningsScore, parseOversToTotalBalls };
