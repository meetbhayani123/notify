/**
 * helpers/matchHelpers.js
 * Utility functions for match state analysis.
 */

const { MATCH_FINISHED_KEYWORDS, T20_FORMAT_KEYWORDS } = require('../config');
const { parseScore } = require('./scoreParser');
const logger = require('../lib/logger');

/**
 * Determine if a match is truly finished (not just innings break or live 2nd innings).
 * Only considers it finished if the result string contains a definitive outcome keyword.
 *
 * @param {object} match — raw match object from the API
 * @returns {boolean}
 */
function isMatchFinished(match) {
  if (match.d !== 2) return false;

  const resStr = (match.res && typeof match.res === 'string') ? match.res.trim().toLowerCase() : '';
  if (resStr === '') return false;
  if (resStr.includes('innings break')) return false;

  const finished = MATCH_FINISHED_KEYWORDS.some(kw => resStr.includes(kw));

  if (finished) {
    logger.info(`🏁 [isMatchFinished] Match FINISHED — d=${match.d}, res="${match.res}"`);
  }

  return finished;
}

/**
 * Helper to check if a match matches common T20/IPL/Hundred formats.
 */
function isT20Match(match) {
  if (!match.fo) return false;
  const fo = match.fo.toLowerCase();
  return T20_FORMAT_KEYWORDS.some(kw => fo.includes(kw));
}

/**
 * Format a score string for display.
 */
function formatScore(match) {
  const parts = [];
  if (match.j) {
    const p = parseScore(match.j);
    if (p) parts.push(`${p.runs}/${p.wickets} (${p.overs} ov)`);
  }
  if (match.k) {
    const p = parseScore(match.k);
    if (p) parts.push(`${p.runs}/${p.wickets} (${p.overs} ov)`);
  }
  if (parts.length === 0) return 'Not started yet';
  if (parts.length === 1) return parts[0];
  return `${parts[0]}  vs  ${parts[1]}`;
}

module.exports = { isMatchFinished, isT20Match, formatScore };
