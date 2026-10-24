/**
 * helpers/tightOverRule.js
 * The tight-over wicket rule, pure and I/O free so it can be reasoned about
 * and tested on its own.
 *
 * One trick, two ways in. For an over that took a wicket:
 *
 *   A — the over finished having gone for TIGHT_OVER_MAX_RUNS or fewer
 *       → alert on that over.
 *
 *   B — the over finished having gone for MORE than that, so the following
 *       over is watched: if a wicket falls there, alert on that over too,
 *       whatever it goes for. Runs do not matter on this path.
 *
 * Path B can be settled the moment the wicket falls, without waiting for the
 * over to end, because its runs are irrelevant. Path A must wait for the over
 * to finish, since a partial over's runs are not its final runs.
 */

const { findOver } = require('./overParser');
const { TIGHT_OVER_MAX_RUNS } = require('../config');

const NOT_EVALUABLE = (reason) => ({ evaluable: false, qualifies: false, reason });

/**
 * Judge one over against the rule.
 *
 * @param {Array} history — parsed over history, oldest first
 * @param {number} overNumber — the over to judge
 * @param {number} [maxRuns]
 * @returns {{evaluable:boolean, qualifies:boolean, trigger?:string, over?:object, previousOver?:object, reason?:string}}
 */
function evaluateOver(history, overNumber, maxRuns = TIGHT_OVER_MAX_RUNS) {
  if (!Array.isArray(history) || history.length === 0) {
    return NOT_EVALUABLE('no over history');
  }

  const over = findOver(history, overNumber);
  if (!over) return NOT_EVALUABLE('over is outside the history window');

  // An over is only proven finished once a later over has begun; until then
  // its runs are a partial total.
  const latest = Math.max(...history.map(o => o.over));
  const finished = latest > overNumber;

  const previous = findOver(history, overNumber - 1);
  const previousFinished = !!previous && latest > previous.over;

  // ── Path B — a wicket in the over after an expensive wicket over ──
  // Decided as soon as the wicket falls; this over's runs are irrelevant.
  if (previous && previousFinished
      && previous.wickets >= 1 && previous.runs > maxRuns
      && over.wickets >= 1) {
    return {
      evaluable: true,
      qualifies: true,
      trigger: 'WICKET_AFTER_EXPENSIVE_OVER',
      over,
      previousOver: previous
    };
  }

  // ── Path A — this over finished tight, with a wicket ──
  if (finished) {
    const qualifies = over.wickets >= 1 && over.runs <= maxRuns;
    return {
      evaluable: true,
      qualifies,
      trigger: qualifies ? 'TIGHT_OVER' : null,
      over,
      previousOver: previous || null
    };
  }

  // Still being bowled and path B does not apply yet — a wicket could still
  // fall in it, so this is not settled either way.
  return NOT_EVALUABLE('over is still being bowled');
}

module.exports = { evaluateOver };
