/**
 * core/pollLoop.js
 * Main polling loop that fetches live matches and delegates to strategies.
 */

const { fetchLiveMatches } = require('../api/poller');
const { isLiveMatch, matchLabel } = require('../helpers/matchFilter');
const { getCurrentInningsScore } = require('../helpers/scoreParser');
const { formatScore } = require('../helpers/matchHelpers');
const { sweepOrphanedTricks } = require('../db/wicketTrickStore');
const { sendTelegramReply, sendTestScoreSummary } = require('../services/telegram');

// ── Strategies ──────────────────────────────────────────
const { handleFirstOverWicket } = require('../strategies/firstOverWicket');
const { handleWicketTrickCheck } = require('../strategies/wicketTrick');
const { handleOverRunsTrick } = require('../strategies/overRunsTrick');
const { detectSecondOverWicket, checkSecondOverWicketTrick } = require('../strategies/secondOverWicket');
const { handleDeathOversWicketTrick } = require('../strategies/deathOversWicket');

const { POLL_INTERVAL_MS, MAX_POLL_INTERVAL_MS, TEST_MODE, TEST_SEND_EVERY } = require('../config');
const logger = require('../lib/logger');

let currentInterval = POLL_INTERVAL_MS;
let pollCount = 0;

/**
 * Single poll tick — fetches data and runs all strategies.
 */
async function tick() {
  pollCount++;

  try {
    const data = await fetchLiveMatches();
    if (!data) {
      currentInterval = Math.min(currentInterval * 2, MAX_POLL_INTERVAL_MS);
      logger.warn(`⚠️ [Poll #${pollCount}] API is down or empty response. Backing off to ${currentInterval / 1000}s`);
      return;
    }

    // API recovered → reset interval
    if (currentInterval !== POLL_INTERVAL_MS) {
      logger.success(`✅ API recovered! Resetting polling interval to ${POLL_INTERVAL_MS / 1000}s`);
    }
    currentInterval = POLL_INTERVAL_MS;

    const matchIds = Object.keys(data);
    let liveMatchCount = 0;
    const liveMatches = [];

    for (const id of matchIds) {
      const match = data[id];

      // ── Test mode: collect live matches with actual scores ──
      const isLive = isLiveMatch(match);
      if (TEST_MODE && isLive && (match.j || match.k)) {
        const label = await matchLabel(id, match);
        const score = getCurrentInningsScore(match);
        liveMatches.push({
          label,
          score: formatScore(match),
          status: match.res || (score ? `${score.overs} ov bowled` : ''),
          currentScore: score
        });
      }

      // ── Production: process all live matches ──
      if (!isLive) continue;
      liveMatchCount++;

      const score = getCurrentInningsScore(match);
      if (!score) continue;

      // Delegate to strategies (non-blocking)
      handleWicketTrickCheck(id, score, match).catch((err) => {
        logger.error(`Error in handleWicketTrickCheck for match ${id}:`, err);
      });

      handleOverRunsTrick(id, score, match).catch((err) => {
        logger.error(`Error in handleOverRunsTrick for match ${id}:`, err);
      });

      detectSecondOverWicket(id, score, match).catch((err) => {
        logger.error(`Error in detectSecondOverWicket for match ${id}:`, err);
      });

      checkSecondOverWicketTrick(id, score, match).catch((err) => {
        logger.error(`Error in checkSecondOverWicketTrick for match ${id}:`, err);
      });

      handleDeathOversWicketTrick(id, score, match).catch((err) => {
        logger.error(`Error in handleDeathOversWicketTrick for match ${id}:`, err);
      });

      // First over wicket detection + alert (awaited for sequential flow)
      await handleFirstOverWicket(id, score, match);
    }

    // ── Test mode: send live scoreboard ──
    if (TEST_MODE && liveMatches.length > 0 && (pollCount === 1 || pollCount % TEST_SEND_EVERY === 0)) {
      try {
        await sendTestScoreSummary(liveMatches);
        logger.success('Test live scoreboard sent successfully to Telegram');
      } catch (err) {
        logger.error('Test scoreboard Telegram send failed', err);
      }
    }

    // Summary log every 10 polls
    if (pollCount % 10 === 1) {
      logger.info(
        `Poll #${pollCount} — ${matchIds.length} total matches, ${liveMatchCount} live tracked, ${liveMatches.length} with scores`
      );
    }

    // Every 150 polls (~5 minutes at 2s interval), sweep orphaned tricks
    if (pollCount % 150 === 0) {
      sweepOrphanedTricks(matchIds, sendTelegramReply).catch((err) => {
        logger.error('Error during orphaned tricks sweep:', err);
      });
    }
  } catch (err) {
    currentInterval = Math.min(currentInterval * 2, MAX_POLL_INTERVAL_MS);
    logger.error(`❌ [Poll #${pollCount}] Unexpected error in tick:`, err);
  } finally {
    setTimeout(tick, currentInterval);
  }
}

/**
 * Start the polling loop.
 */
function startPollLoop() {
  tick();
}

module.exports = { startPollLoop };
