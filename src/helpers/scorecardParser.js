/**
 * helpers/scorecardParser.js
 * Decodes the compact scorecard payload from the GoScorer API (getSC4).
 *
 * The response is an array of innings objects:
 *   a  – bowling figures:  "bowlerKey.runs.balls.maidens.wickets"
 *   b  – batting card in BATTING ORDER (not dismissal order)
 *   c  – batting team key
 *   d  – "runs/wickets(balls"   ← note: BALLS, not overs (unlike getLiveMatches)
 *   e  – extras
 *   x  – "captainKey/wicketKeeperKey"
 *
 * Batting entry format — dot-separated fields, then a "/" and the batter's
 * CAREER figures ("<average>-<strikeRate>", or "-" when unavailable):
 *   "key.runs.balls.fours.sixes.ballsAtDismissal.teamRuns.dismissalType.bowlerKey[.fielderKey]/<career>/"
 *   "key.runs.balls.fours.sixes/<career>"   → not out
 *   "key/<career>"                          → did not bat
 *
 * A DISMISSED batter's entry ends with a trailing "/". Do not key off the
 * literal "/-/": that only appears when career figures are missing. Real
 * entries look like "72.56.23.6.4.25.60.2.CO.B7/26.82-157.03/" (out) and
 * "FL.102.50.4.9/31.70-139.55" (not out). The career strike rate is NOT the
 * innings strike rate, which is computed from runs and balls below.
 *
 * INNINGS ORDER: the array is ordered by innings — index 0 is the team that
 * batted first. Do NOT use the `cd` field for this. It looks like an innings
 * index on some matches and is not: real payloads carry cd=2 then cd=0, cd=1
 * then cd=0, and cd=0 twice. Verified against getSV3's j/k (the authoritative
 * 1st/2nd innings scores) across four matches, where array order was correct
 * every time and cd order was wrong on half of them.
 */

const SCORE_REGEX = /^(\d+)\/(\d+)\((\d+)/;

/**
 * Parse one batting entry.
 *
 * @param {string} raw
 * @returns {object|null}
 */
function parseBatter(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Everything before the first "/" is this innings' data; a trailing "/"
  // after the career figures marks the batter as dismissed.
  const dismissed = raw.endsWith('/');
  const fields = raw.split('/')[0].split('.');
  const key = fields[0];
  if (!key) return null;

  // Fewer than 5 fields means the player has no figures yet — yet to bat.
  if (fields.length < 5) {
    return { key, didNotBat: true, out: false, runs: null, balls: null, strikeRate: null };
  }

  const runs  = parseInt(fields[1], 10);
  const balls = parseInt(fields[2], 10);
  if (!Number.isFinite(runs) || !Number.isFinite(balls)) {
    return { key, didNotBat: true, out: false, runs: null, balls: null, strikeRate: null };
  }

  return {
    key,
    didNotBat: false,
    out: dismissed,
    runs,
    balls,
    fours: parseInt(fields[3], 10) || 0,
    sixes: parseInt(fields[4], 10) || 0,
    strikeRate: balls > 0 ? (runs / balls) * 100 : 0,
    ballsAtDismissal:    dismissed ? parseInt(fields[5], 10) : null,
    teamRunsAtDismissal: dismissed ? parseInt(fields[6], 10) : null,
    bowlerKey:  dismissed ? (fields[8] || null) : null,
    fielderKey: dismissed ? (fields[9] || null) : null
  };
}

/**
 * Parse one innings object.
 *
 * @param {object} entry
 * @param {number} index — position in the scorecard array, which IS the innings order
 */
function parseInningsEntry(entry, index = 0) {
  if (!entry || typeof entry !== 'object') return null;

  const [captainKey, wicketKeeperKey] = String(entry.x || '').split('/');
  const m = String(entry.d || '').match(SCORE_REGEX);

  return {
    inningsNo: index + 1,
    battingTeamKey: entry.c || null,
    runs:    m ? parseInt(m[1], 10) : null,
    wickets: m ? parseInt(m[2], 10) : null,
    balls:   m ? parseInt(m[3], 10) : null,
    captainKey: captainKey || null,
    wicketKeeperKey: wicketKeeperKey || null,
    batters: Array.isArray(entry.b)
      ? entry.b.map(parseBatter).filter(Boolean)
      : []
  };
}

/**
 * Decode a full getSC4 payload.
 *
 * @param {Array|undefined} payload — raw API response
 * @returns {Array<object>|null} parsed innings, or null when unusable
 */
function parseScorecard(payload) {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const innings = payload
    .map((entry, index) => parseInningsEntry(entry, index))
    .filter(Boolean);
  return innings.length > 0 ? innings : null;
}

/**
 * Find the innings with the given 1-based number.
 */
function findInnings(innings, inningsNo) {
  if (!Array.isArray(innings)) return null;
  return innings.find(i => i.inningsNo === inningsNo) || null;
}

/**
 * Look up a batter by player key within an innings.
 */
function findBatter(innings, playerKey) {
  if (!innings || !playerKey) return null;
  return innings.batters.find(b => b.key === playerKey) || null;
}

module.exports = {
  parseBatter,
  parseInningsEntry,
  parseScorecard,
  findInnings,
  findBatter
};
