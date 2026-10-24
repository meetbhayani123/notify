/**
 * helpers/overParser.js
 * Decodes the per-over history from the GoScorer match-state API (getSV3).
 *
 * The `rb` field is a rolling window of the most recent overs of the innings
 * currently being bowled:
 *   o  – over number (over 17 covers balls 16.1 – 17.0)
 *   r  – runs scored in that over, extras included
 *   ts – team score AFTER that over, "runs/wickets"
 *   bt – batting team key
 *   b  – ball by ball, each { d: delivery number, u: outcome }
 *        u is "w" for a wicket, "wd" for a wide, "1lb" for a leg bye, etc.
 *
 * NOTE: `i` is NOT the innings number — it reads 1 for a second innings — so
 * it is ignored here. Callers establish the innings from the live feed instead.
 */

const TEAM_SCORE_REGEX = /^(\d+)\/(\d+)/;

/** Wickets in an over, counted from the ball outcomes. */
function countWicketBalls(balls) {
  if (!Array.isArray(balls)) return 0;
  return balls.filter(b => b && String(b.u).toLowerCase() === 'w').length;
}

/** Parse a "runs/wickets" team score into its parts. */
function parseTeamScore(ts) {
  const m = TEAM_SCORE_REGEX.exec(String(ts || ''));
  if (!m) return null;
  return { runs: parseInt(m[1], 10), wickets: parseInt(m[2], 10) };
}

/**
 * Decode the `rb` window into completed-over summaries, oldest first.
 *
 * Runs and wickets are taken from the scoreboard delta between consecutive
 * overs where possible, since that is the scoreboard's own arithmetic, and
 * fall back to the over's own `r` field and ball outcomes for the oldest
 * entry, which has no predecessor in the window.
 *
 * @param {Array|undefined} rb — raw getSV3 `rb` array
 * @returns {Array<{over:number,runs:number,wickets:number,battingTeamKey:string,scoreAfter:object|null}>}
 */
function parseOverHistory(rb) {
  if (!Array.isArray(rb) || rb.length === 0) return [];

  const sorted = rb
    .filter(o => o && Number.isFinite(Number(o.o)))
    .sort((a, b) => Number(a.o) - Number(b.o));

  return sorted.map((entry, index) => {
    const over = Number(entry.o);
    const after = parseTeamScore(entry.ts);
    const before = index > 0 ? parseTeamScore(sorted[index - 1].ts) : null;
    const contiguous = index > 0 && Number(sorted[index - 1].o) === over - 1;

    const runsFromDelta = (after && before && contiguous) ? after.runs - before.runs : null;
    const wicketsFromDelta = (after && before && contiguous) ? after.wickets - before.wickets : null;

    const runs = Number.isFinite(runsFromDelta) && runsFromDelta >= 0
      ? runsFromDelta
      : Number(entry.r) || 0;
    const wickets = Number.isFinite(wicketsFromDelta) && wicketsFromDelta >= 0
      ? wicketsFromDelta
      : countWicketBalls(entry.b);

    return {
      over,
      runs,
      wickets,
      battingTeamKey: entry.bt || null,
      scoreAfter: after
    };
  });
}

/**
 * Find one over in a parsed history.
 */
function findOver(history, overNumber) {
  if (!Array.isArray(history)) return null;
  return history.find(o => o.over === overNumber) || null;
}

module.exports = { parseOverHistory, findOver, parseTeamScore, countWicketBalls };
