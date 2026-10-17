/**
 * helpers/scorecardParser.js
 * Decodes the compact scorecard payload from the GoScorer API (getSC4).
 *
 * The response is an array of innings objects:
 *   a  – bowling figures:  "bowlerKey.runs.balls.maidens.wickets"
 *   b  – batting card in BATTING ORDER (not dismissal order)
 *   c  – batting team key
 *   cd – zero-based innings index
 *   d  – "runs/wickets(balls"   ← note: BALLS, not overs (unlike getLiveMatches)
 *   e  – extras
 *   x  – "captainKey/wicketKeeperKey"
 *
 * Batting entry format:
 *   "key.runs.balls.fours.sixes"                                  → not out
 *   "key.runs.balls.fours.sixes.ballsAtDismissal.teamRunsAtDismissal.dismissalType.bowlerKey[.fielderKey]"
 *   "key"                                                         → did not bat
 * Suffixed with "/-/" when dismissed and "/-" when not out or yet to bat.
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

  const dismissed = raw.endsWith('/-/');
  const fields = raw.replace(/\/-\/?$/, '').split('.');
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
 */
function parseInningsEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const [captainKey, wicketKeeperKey] = String(entry.x || '').split('/');
  const m = String(entry.d || '').match(SCORE_REGEX);

  return {
    inningsNo: Number.isInteger(entry.cd) ? entry.cd + 1 : null,
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
  const innings = payload.map(parseInningsEntry).filter(Boolean);
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
