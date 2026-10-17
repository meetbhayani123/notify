/**
 * helpers/scorecardTrickRules.js
 * Pure rule evaluation for the scorecard-derived tricks.
 *
 * Every rule takes a parsed innings (see scorecardParser.js) and returns
 *   { evaluable: boolean, qualifies: boolean, ... details }
 * with no I/O, so the rules can be reasoned about and tested in isolation.
 *
 *   CAPTAIN_TOP_SCORER       — T20, end of 1st innings: nobody out-scored the captain
 *   KEEPER_NOT_OUT          — T20 + ODI, end of 1st innings: keeper finished not out
 *   KEEPER_TOP_SCORER       — T20 + ODI, end of 1st innings: nobody out-scored the keeper
 *   OPENERS_HIGH_SR         — ODI, either innings: both openers out, one struck at 101+
 *   CAPTAIN_CHEAP_DISMISSAL — T20, either innings: captain out, SR under 100 off 10+ balls
 */

const { findBatter } = require('./scorecardParser');
const {
  OPENER_HIGH_SR_MIN,
  CAPTAIN_CHEAP_MAX_SR,
  CAPTAIN_CHEAP_MIN_BALLS
} = require('../config');

const NOT_EVALUABLE = (reason) => ({ evaluable: false, qualifies: false, reason });

/** Batters who actually took strike, excluding one player key. */
function otherBatters(innings, excludeKey) {
  return innings.batters.filter(b => !b.didNotBat && b.key !== excludeKey);
}

/**
 * Highest individual score among everyone except the named player.
 * Returns { runs, batter } — runs is 0 when nobody else batted.
 */
function topScoreExcluding(innings, excludeKey) {
  const others = otherBatters(innings, excludeKey);
  let best = null;
  for (const b of others) {
    if (!best || b.runs > best.runs) best = b;
  }
  return { runs: best ? best.runs : 0, batter: best };
}

/**
 * Shared "is this player the top scorer" rule.
 * A tie counts as qualifying (joint-highest is still highest).
 */
function isTopScorer(innings, playerKey, role) {
  const player = findBatter(innings, playerKey);
  if (!player) return NOT_EVALUABLE(`${role} not found on the scorecard`);
  if (player.didNotBat) return NOT_EVALUABLE(`${role} did not bat`);

  const top = topScoreExcluding(innings, playerKey);

  return {
    evaluable: true,
    // Guard against a 0-run "top score" in an innings where nobody has scored.
    qualifies: player.runs > 0 && player.runs >= top.runs,
    player,
    topOtherRuns: top.runs,
    topOtherBatter: top.batter,
    tied: !!(top.batter && player.runs === top.runs)
  };
}

/** T1 — T20, end of 1st innings: every other batter scored less than the captain. */
function captainTopScorer(innings) {
  return isTopScorer(innings, innings.captainKey, 'Captain');
}

/** T7 — T20 + ODI, end of 1st innings: every other batter scored less than the keeper. */
function keeperTopScorer(innings) {
  return isTopScorer(innings, innings.wicketKeeperKey, 'Wicketkeeper');
}

/**
 * T2 + T5 — T20 + ODI, end of 1st innings: the keeper batted and was not dismissed.
 * A keeper who never took strike does not count as "batted through".
 */
function keeperNotOut(innings) {
  const wk = findBatter(innings, innings.wicketKeeperKey);
  if (!wk) return NOT_EVALUABLE('Wicketkeeper not found on the scorecard');
  if (wk.didNotBat) return NOT_EVALUABLE('Wicketkeeper did not bat');

  return {
    evaluable: true,
    qualifies: !wk.out && wk.balls > 0,
    player: wk
  };
}

/**
 * T3 — ODI, either innings: both opening batters are out; report both their
 * strike rates and qualify when at least one struck at OPENER_HIGH_SR_MIN or better.
 */
function openersHighStrikeRate(innings) {
  const openers = innings.batters.slice(0, 2);
  if (openers.length < 2) return NOT_EVALUABLE('Fewer than two batters on the scorecard');
  if (openers.some(b => b.didNotBat)) return NOT_EVALUABLE('Openers have no figures yet');
  if (!openers.every(b => b.out)) return NOT_EVALUABLE('Both openers are not out yet');

  const high = openers.filter(b => b.strikeRate >= OPENER_HIGH_SR_MIN);

  return {
    evaluable: true,
    qualifies: high.length > 0,
    openers,
    highStrikers: high
  };
}

/**
 * T4 — T20, either innings: the captain is out having struck below
 * CAPTAIN_CHEAP_MAX_SR off at least CAPTAIN_CHEAP_MIN_BALLS balls.
 */
function captainCheapDismissal(innings) {
  const cap = findBatter(innings, innings.captainKey);
  if (!cap) return NOT_EVALUABLE('Captain not found on the scorecard');
  if (cap.didNotBat) return NOT_EVALUABLE('Captain did not bat');
  if (!cap.out) return NOT_EVALUABLE('Captain is still batting');

  return {
    evaluable: true,
    qualifies: cap.strikeRate < CAPTAIN_CHEAP_MAX_SR && cap.balls >= CAPTAIN_CHEAP_MIN_BALLS,
    player: cap
  };
}

module.exports = {
  captainTopScorer,
  keeperTopScorer,
  keeperNotOut,
  openersHighStrikeRate,
  captainCheapDismissal,
  topScoreExcluding
};
