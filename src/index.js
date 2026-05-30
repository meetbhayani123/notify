/**
 * index.js — Cricket Wicket Alert System
 * Entry point: starts WhatsApp client, then polls the cricket API
 * every N seconds looking for first-over wickets in live T20 matches.
 *
 * TEST_MODE=true  → sends live scoreboard to group every 30s
 * TEST_MODE=false → production mode, only first-over wicket alerts
 */

require('dotenv').config();

const { fetchLiveMatches }                        = require('./poller');
const { isLiveMatch, matchLabel }                 = require('./matchFilter');
const { parseScore, getCurrentInningsScore }      = require('./scoreParser');
const {
  initDB,
  checkForWicket,
  getMatchState,
  saveFirstOverSessionEvent,
  createWicketTrick,
  getActiveWicketTrick,
  resolveWicketTrick,
  sweepOrphanedTricks,
  getFirstOverRuns,
  checkOverRunsTrickEvaluated,
  saveOverRunsTrickEvaluation,
  createSecondOverWicketTrick,
  getActiveSecondOverWicketTrick,
  resolveSecondOverWicketTrick,
  checkSecondOverWicketTrickExists
} = require('./stateManager');
const {
  initTelegram,
  sendTelegramAlert,
  sendTelegramReply,
  sendTrickNotifyAlert,
  sendSecondOverWicketAlert,

  sendTestScoreSummary
} = require('./notifier');
// Twilio calling is disabled for now
// const { initTwilio, triggerVoiceAlert }           = require('./twilioNotifier');
const { initTeamResolver, resolveTeamName }        = require('./teamResolver');
const logger                                      = require('./logger');
const express                                     = require('express');

// ── Config ──────────────────────────────────────────────
const BASE_INTERVAL = Math.max(
  parseInt(process.env.POLL_INTERVAL_MS, 10) || 2000,
  1000
);
const MAX_INTERVAL = 30000; // Max wait: 30 seconds during API downtime
let currentInterval = BASE_INTERVAL;

const TEST_MODE = process.env.TEST_MODE === 'true';

// Twilio calling is disabled for now
// const TWILIO_CALL_DELAY_MS = Math.max(
//   parseInt(process.env.TWILIO_CALL_DELAY_MS, 10) || 5000,
//   0
// );

// In test mode, send a score summary every TEST_SEND_EVERY polls
// At 2s polling, 15 polls = every 30 seconds
const TEST_SEND_EVERY = 15;

let pollCount = 0;

// ── Env validation ──────────────────────────────────────
function validateEnv() {
  const required = [
    'CRICKET_API_URL',
    'CRICKET_API_JWT',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID'
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ Missing required .env variables:', missing.join(', '));
    process.exit(1);
  }

  // Check for obvious placeholder values
  if (process.env.CRICKET_API_JWT === 'your_jwt_token_here') {
    console.error('❌ CRICKET_API_JWT is still a placeholder — update .env');
    process.exit(1);
  }
}

// ── IST timestamp helper ────────────────────────────────
function ist() {
  return new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
}

// ── Wait helper ─────────────────────────────────────────
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Format a score string for display ───────────────────
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

/**
 * Keywords that indicate a match has truly finished (result is final).
 * We only consider a match "finished" if match.res contains one of these.
 * This prevents false positives during live 2nd innings where the API may
 * set d=2 and res contains informational text (target, RRR, etc.).
 */
const MATCH_FINISHED_KEYWORDS = [
  'won by', 'won the', 'tied', 'draw', 'drawn',
  'abandoned', 'no result', 'super over',
  'dls', 'd/l', 'concede', 'forfeited'
];

/**
 * Determine if a match is truly finished (not just innings break or live 2nd innings).
 * @param {object} match — raw match object from the API
 * @returns {boolean}
 */
function isMatchFinished(match) {
  // d !== 2 means match is still live (d=1) or not started
  if (match.d !== 2) return false;

  const resStr = (match.res && typeof match.res === 'string') ? match.res.trim().toLowerCase() : '';
  if (resStr === '') return false;

    // Innings break is NOT a finished match
    if (resStr.includes('innings break')) return false;

    // Only consider it finished if the result string contains a definitive outcome keyword
    const finished = MATCH_FINISHED_KEYWORDS.some(kw => resStr.includes(kw));

    // Debug log to trace the decision — helps diagnose future false positives
    if (finished) {
      logger.info(`🏁 [isMatchFinished] Match FINISHED — d=${match.d}, res="${match.res}"`);
    } else {
      logger.info(`⏳ [isMatchFinished] Match NOT finished (d=${match.d}, res="${match.res}") — no result keyword found, treating as live`);
    }

    return finished;
}

const processingTricks = new Set();

/**
 * Checks and handles the Wicket Trick logic for active sessions.
 */
async function handleWicketTrickCheck(matchId, score, match) {
  const activeTrick = await getActiveWicketTrick(matchId, score.innings);
  if (!activeTrick) return;

  const trickKey = `${matchId}_${score.innings}`;
  if (processingTricks.has(trickKey)) return;

  const currentWickets = score.wickets;
  const initialWickets = activeTrick.initialWickets;
  const currentBalls = score.balls;

  // Check if the match is truly finished (final result declared)
  const isFinished = isMatchFinished(match);

  if (currentWickets > initialWickets) {
    if (currentBalls <= 24) {
      // Success! Another wicket fell within the first 4 overs (<= 24 balls)
      processingTricks.add(trickKey);
      logger.success(`🎯 [TRICK SUCCESS] Match ${matchId} innings ${score.innings} — Wickets went from ${initialWickets} to ${currentWickets} in ${score.overs} ov.`);
      try {
        const msg = `Done ✅\n*${activeTrick.battingTeam}*: ${score.runs}/${score.wickets} (${score.overs} ov)`;
        await sendTelegramReply(activeTrick.telegramMessageId, msg);
        await resolveWicketTrick(matchId, score.innings, 'DONE');
      } catch (err) {
        logger.error(`❌ Failed to resolve Wicket Trick (Success) for match ${matchId}:`, err);
      } finally {
        processingTricks.delete(trickKey);
      }
    } else {
      // Failure: Wickets increased but after the 4 overs limit
      processingTricks.add(trickKey);
      logger.info(`🚨 [TRICK FAIL] Match ${matchId} innings ${score.innings} — Another wicket fell at ${score.overs} ov (after 4 overs limit).`);
      try {
        const msg = `Fail ❌ (Wicket fell after 4 overs)\n*${activeTrick.battingTeam}*: ${score.runs}/${score.wickets} (${score.overs} ov)`;
        await sendTelegramReply(activeTrick.telegramMessageId, msg);
        await resolveWicketTrick(matchId, score.innings, 'FAIL');
      } catch (err) {
        logger.error(`❌ Failed to resolve Wicket Trick (Fail) for match ${matchId}:`, err);
      } finally {
        processingTricks.delete(trickKey);
      }
    }
  } else if (currentBalls >= 24 || isFinished) {
    // Failure: 4 overs completed (or match finished) with no other wickets
    processingTricks.add(trickKey);
    logger.info(`🚨 [TRICK FAIL] Match ${matchId} innings ${score.innings} — 4 overs completed (or match finished) at ${score.overs} ov with no other wicket.`);
    try {
      const reason = isFinished ? 'Match finished' : '4 overs completed';
      const msg = `Fail ❌ (${reason})\n*${activeTrick.battingTeam}*: ${score.runs}/${score.wickets} (${score.overs} ov)`;
      await sendTelegramReply(activeTrick.telegramMessageId, msg);
      await resolveWicketTrick(matchId, score.innings, 'FAIL');
    } catch (err) {
      logger.error(`❌ Failed to resolve Wicket Trick (Fail) for match ${matchId}:`, err);
    } finally {
      processingTricks.delete(trickKey);
    }
  }
}

/**
 * Helper to check if a match matches common T20/IPL/Hundred formats.
 */
function isT20Match(match) {
  if (!match.fo) return false;
  const fo = match.fo.toLowerCase();
  return (
    fo.includes('t20') ||
    fo.includes('ipl') ||
    fo.includes('hundred') ||
    fo.includes('bbl') ||
    fo.includes('cpl') ||
    fo.includes('psl') ||
    fo.includes('wpl') ||
    fo.includes('t-20')
  );
}

const processingOverRuns = new Set();

/**
 * Checks and handles the 1st Over Runs trick for T20 matches.
 */
async function handleOverRunsTrickCheck(matchId, score, match) {
  // Rule only applies to T20 matches
  if (!isT20Match(match)) return;

  // Must have completed the first over (balls >= 6)
  if (score.balls < 6) return;

  // Ensure we haven't already evaluated this match/innings
  const evaluated = await checkOverRunsTrickEvaluated(matchId, score.innings);
  if (evaluated) return;

  const trickKey = `${matchId}_${score.innings}`;
  if (processingOverRuns.has(trickKey)) return;

  processingOverRuns.add(trickKey);
  try {
    // Get the exact runs at the end of the 1st over
    const runsAtFirstOver = await getFirstOverRuns(matchId, score.innings, score);

    const label = await matchLabel(matchId, match);
    const battingTeam = await resolveTeamName(score.battingTeamKey);

    if (runsAtFirstOver === null || runsAtFirstOver === undefined) {
      logger.info(`📊 [OVER RUNS TRICK SKIPPED] Match ${label} Innings ${score.innings} — No first over history captured. Skipping.`);
      await saveOverRunsTrickEvaluation({
        matchId,
        innings: score.innings,
        battingTeam,
        runsAtFirstOver: null,
        ballsAtEvaluation: score.balls,
        notified: false,
        status: 'SKIPPED'
      });
      return;
    }

    // Check trick conditions:
    // Innings 1: runs >= 14
    // Innings 2: runs >= 13
    const threshold = score.innings === 1 ? 14 : 13;
    const isTargetMet = runsAtFirstOver >= threshold;

    if (isTargetMet) {
      logger.success(`📊 [OVER RUNS TRICK SUCCESS] Match ${label} Innings ${score.innings} — ${runsAtFirstOver} runs (Threshold: >= ${threshold}). Sending Alert.`);
      await sendTrickNotifyAlert({
        matchLabel: label,
        innings: score.innings,
        battingTeam,
        runs: runsAtFirstOver,
        threshold
      });
      await saveOverRunsTrickEvaluation({
        matchId,
        innings: score.innings,
        battingTeam,
        runsAtFirstOver,
        ballsAtEvaluation: score.balls,
        notified: true,
        status: 'NOTIFIED'
      });
    } else {
      logger.info(`📊 [OVER RUNS TRICK SKIPPED] Match ${label} Innings ${score.innings} — ${runsAtFirstOver} runs (Threshold: >= ${threshold}). Did not meet criteria.`);
      await saveOverRunsTrickEvaluation({
        matchId,
        innings: score.innings,
        battingTeam,
        runsAtFirstOver,
        ballsAtEvaluation: score.balls,
        notified: false,
        status: 'SKIPPED'
      });
    }
  } catch (err) {
    logger.error(`❌ Error during Over Runs Trick evaluation for match ${matchId}:`, err);
  } finally {
    processingOverRuns.delete(trickKey);
  }
}

const processingSecondOverWicket = new Set();

// Tracks previous wicket count per match/innings to detect when a wicket
// actually falls during the 2nd over vs. already having fallen earlier.
const prevWicketCountMap = new Map();

/**
 * Detects if the first wicket falls in the 2nd over of any innings.
 * Uses overs (not ball count) to avoid counting wides, no-balls, etc.
 *
 * Strategy: "2nd Over Wicket Trick"
 *   - Trigger: First wicket falls during the 2nd over (overs 1.1 to 2.0)
 *   - Then wait for the next wicket:
 *     - If another wicket falls before 5th over completes (overs <= 5.0) → Done ✅
 *     - If 5th over completes (overs >= 5.0) with no further wicket → Fail ❌
 */
async function handleSecondOverWicketDetection(matchId, score, match) {
  const stateKey = `${matchId}_${score.innings}`;

  // Track wicket count transitions to know when a wicket actually falls.
  // If we haven't seen this match/innings yet, assume 0 previous wickets.
  const prevWickets = prevWicketCountMap.get(stateKey) || 0;
  prevWicketCountMap.set(stateKey, score.wickets);

  // Only check during the 2nd over (overs 1.1 to 2.0)
  // Overs only count legal deliveries — wides/no-balls don't advance the over count
  if (score.overs < 1.1 || score.overs > 2.0) return;

  // Only trigger if exactly 1 wicket has fallen AND it just transitioned from 0 to 1
  // This prevents false triggers when a wicket fell in the 1st over and we're
  // just now polling in the 2nd over with the same wicket count.
  if (score.wickets !== 1) return;
  if (prevWickets !== 0) return; // Wicket already existed before this poll — fell earlier

  // Check if we've already created a trick for this match/innings
  const exists = await checkSecondOverWicketTrickExists(matchId, score.innings);
  if (exists) return;

  const trickKey = `2ndov_${matchId}_${score.innings}`;
  if (processingSecondOverWicket.has(trickKey)) return;

  processingSecondOverWicket.add(trickKey);
  try {
    const label = await matchLabel(matchId, match);
    const battingTeam = await resolveTeamName(score.battingTeamKey);

    logger.success(`🎯 [2ND OVER WICKET] Match ${label} Innings ${score.innings} — First wicket fell in 2nd over at ${score.overs} ov. Sending trick alert.`);

    // Send notification to the trick channel
    const telegramMessageId = await sendSecondOverWicketAlert({
      matchLabel: label,
      innings: score.innings,
      battingTeam,
      runs: score.runs,
      wickets: score.wickets,
      overs: score.overs
    });

    if (telegramMessageId) {
      // Create the tracking session
      await createSecondOverWicketTrick({
        matchId,
        innings: score.innings,
        battingTeam,
        telegramMessageId,
        initialWickets: score.wickets,
        wicketBalls: score.balls
      });
      logger.success(`✅ [2ND OVER WICKET] Trick session created for ${label} Innings ${score.innings} (Msg ID: ${telegramMessageId})`);
    }
  } catch (err) {
    logger.error(`❌ Error during 2nd Over Wicket Detection for match ${matchId}:`, err);
  } finally {
    processingSecondOverWicket.delete(trickKey);
  }
}

const processingSecondOverTrickCheck = new Set();

/**
 * Monitors an active 2nd Over Wicket Trick session.
 * Uses overs (not ball count) for all comparisons to avoid counting wides/no-balls.
 * Checks if another wicket falls before 5th over (overs <= 5.0) → Done
 * Or if 5th over completes (overs >= 5.0) with no further wicket → Fail
 */
async function handleSecondOverWicketTrickCheck(matchId, score, match) {
  const activeTrick = await getActiveSecondOverWicketTrick(matchId, score.innings);
  if (!activeTrick) return;

  const trickKey = `2ndov_chk_${matchId}_${score.innings}`;
  if (processingSecondOverTrickCheck.has(trickKey)) return;

  const currentWickets = score.wickets;
  const initialWickets = activeTrick.initialWickets;
  const currentOvers = score.overs;

  // Check if the match is truly finished (final result declared)
  const isFinished = isMatchFinished(match);

  if (currentWickets > initialWickets) {
    if (currentOvers <= 5.0) {
      // Success! Another wicket fell within the first 5 overs
      processingSecondOverTrickCheck.add(trickKey);
      logger.success(`🎯 [2ND OVER TRICK SUCCESS] Match ${matchId} innings ${score.innings} — Wickets went from ${initialWickets} to ${currentWickets} at ${score.overs} ov.`);
      try {
        const battingTeam = activeTrick.battingTeam;
        const msg = `Done ✅\n*${battingTeam}*: ${score.runs}/${score.wickets} (${score.overs} ov)`;
        await sendTelegramReply(activeTrick.telegramMessageId, msg);
        await resolveSecondOverWicketTrick(matchId, score.innings, 'DONE');
      } catch (err) {
        logger.error(`❌ Failed to resolve 2nd Over Wicket Trick (Success) for match ${matchId}:`, err);
      } finally {
        processingSecondOverTrickCheck.delete(trickKey);
      }
    } else {
      // Failure: Another wicket fell but after the 5th over
      processingSecondOverTrickCheck.add(trickKey);
      logger.info(`🚨 [2ND OVER TRICK FAIL] Match ${matchId} innings ${score.innings} — Another wicket fell at ${score.overs} ov (after 5 overs limit).`);
      try {
        const battingTeam = activeTrick.battingTeam;
        const msg = `Fail ❌ (Wicket fell after 5 overs)\n*${battingTeam}*: ${score.runs}/${score.wickets} (${score.overs} ov)`;
        await sendTelegramReply(activeTrick.telegramMessageId, msg);
        await resolveSecondOverWicketTrick(matchId, score.innings, 'FAIL');
      } catch (err) {
        logger.error(`❌ Failed to resolve 2nd Over Wicket Trick (Fail) for match ${matchId}:`, err);
      } finally {
        processingSecondOverTrickCheck.delete(trickKey);
      }
    }
  } else if (currentOvers >= 5.0 || isFinished) {
    // Failure: 5 overs completed (or match finished) with no other wickets
    processingSecondOverTrickCheck.add(trickKey);
    logger.info(`🚨 [2ND OVER TRICK FAIL] Match ${matchId} innings ${score.innings} — 5 overs completed (or match finished) at ${score.overs} ov with no other wicket.`);
    try {
      const reason = isFinished ? 'Match finished' : '5 overs completed';
      const battingTeam = activeTrick.battingTeam;
      const msg = `Fail ❌ (${reason})\n*${battingTeam}*: ${score.runs}/${score.wickets} (${score.overs} ov)`;
      await sendTelegramReply(activeTrick.telegramMessageId, msg);
      await resolveSecondOverWicketTrick(matchId, score.innings, 'FAIL');
    } catch (err) {
      logger.error(`❌ Failed to resolve 2nd Over Wicket Trick (Fail) for match ${matchId}:`, err);
    } finally {
      processingSecondOverTrickCheck.delete(trickKey);
    }
  }
}

// ── Single poll tick ────────────────────────────────────
async function tick() {
  pollCount++;

  try {
    const data = await fetchLiveMatches();
    if (!data) {
      // API failed or returned null (timeout/offline) -> increase wait time (exponential backoff)
      currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL);
      logger.warn(`⚠️ [Poll #${pollCount}] API is down or empty response. Backing off to ${currentInterval / 1000}s`);
      return;
    }

    // API recovered or succeeded -> reset back to base interval
    if (currentInterval !== BASE_INTERVAL) {
      logger.success(`✅ API recovered! Resetting polling interval to ${BASE_INTERVAL / 1000}s`);
    }
    currentInterval = BASE_INTERVAL;

    const matchIds    = Object.keys(data);
    let liveT20Count  = 0;
    const liveMatches = [];  // for test mode

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

      // ── Production: process all live matches ───────────────────
      if (!isLive) continue;
      liveT20Count++;

      const score = getCurrentInningsScore(match);
      if (!score) continue;            // innings not started

      // Process Wicket Trick state checks (non-blocking)
      handleWicketTrickCheck(id, score, match).catch((err) => {
        logger.error(`Error in handleWicketTrickCheck for match ${id}:`, err);
      });

      // Process Over Runs Trick state checks (non-blocking)
      handleOverRunsTrickCheck(id, score, match).catch((err) => {
        logger.error(`Error in handleOverRunsTrickCheck for match ${id}:`, err);
      });

      // Process 2nd Over Wicket Trick detection (non-blocking)
      handleSecondOverWicketDetection(id, score, match).catch((err) => {
        logger.error(`Error in handleSecondOverWicketDetection for match ${id}:`, err);
      });

      // Process 2nd Over Wicket Trick state checks (non-blocking)
      handleSecondOverWicketTrickCheck(id, score, match).catch((err) => {
        logger.error(`Error in handleSecondOverWicketTrickCheck for match ${id}:`, err);
      });

      // Live Tracking Log for first over
      if (score.isFirstOver) {
        const label = await matchLabel(id, match);
        const battingTeam = await resolveTeamName(score.battingTeamKey);
        const dbState = await getMatchState(id);
        const notifiedStr = (dbState && dbState.notified) ? '✅ Alert Sent' : '⏳ Waiting for Wicket';
        logger.live(`${label} — Batting: ${battingTeam} (${score.innings === 1 ? '1st' : '2nd'} Innings) — ${score.runs}/${score.wickets} (${score.overs} ov) — [${notifiedStr}]`);

        // Save to MongoDB asynchronously (non-blocking)!
        saveFirstOverSessionEvent({
          matchId: id,
          matchLabel: label,
          innings: score.innings,
          battingTeam: battingTeam,
          score: score,
          notified: !!(dbState && dbState.notified),
          action: 'poll_received'
        }).catch(() => {});
      }

      const result = await checkForWicket(id, score);
      if (!result.wicketFell) continue;

      const label = await matchLabel(id, match);
      const battingTeam = await resolveTeamName(score.battingTeamKey);
      logger.success(
        `WICKET in 1st over! ${label} — Batting: ${battingTeam} (${score.innings === 1 ? '1st' : '2nd'} Innings) — ${score.runs}/${score.wickets} (${score.overs} ov)`
      );

      // Save alert trigger to history asynchronously (non-blocking)!
      saveFirstOverSessionEvent({
        matchId: id,
        matchLabel: label,
        innings: score.innings,
        battingTeam: battingTeam,
        score: score,
        notified: true,
        action: 'alert_triggered'
      }).catch(() => {});

      try {
        const telegramMessageId = await sendTelegramAlert({
          matchLabel:  label,
          matchId:     id,
          prevWickets: result.prevWickets,
          newWickets:  result.newWickets,
          overs:       score.overs,
          runs:        score.runs,
          battingTeam: battingTeam,
          innings:     score.innings
        });
        logger.success(`Telegram alert sent successfully for ${label} (Msg ID: ${telegramMessageId})`);

        if (telegramMessageId) {
          // Create Wicket Trick session to track subsequent wickets
          createWicketTrick({
            matchId: id,
            innings: score.innings,
            battingTeam,
            telegramMessageId,
            initialWickets: score.wickets
          }).catch((err) => {
            logger.error(`Failed to create Wicket Trick session for ${label}:`, err);
          });
        }

        // Save alert success to history asynchronously (non-blocking)!
        saveFirstOverSessionEvent({
          matchId: id,
          matchLabel: label,
          innings: score.innings,
          battingTeam: battingTeam,
          score: score,
          notified: true,
          action: 'alert_success',
          telegramStatus: 'SUCCESS'
        }).catch(() => {});
      } catch (err) {
        logger.error(`Telegram send failed for ${label}`, err);

        // Save alert failure to history asynchronously (non-blocking)!
        saveFirstOverSessionEvent({
          matchId: id,
          matchLabel: label,
          innings: score.innings,
          battingTeam: battingTeam,
          score: score,
          notified: true,
          action: 'alert_failed',
          telegramStatus: 'FAILED',
          telegramError: err
        }).catch(() => {});
      }

      // Twilio calling is disabled for now
      // (async () => {
      //   if (TWILIO_CALL_DELAY_MS > 0) {
      //     logger.info(`⏳ Waiting ${TWILIO_CALL_DELAY_MS / 1000}s before triggering Twilio call to prioritize Telegram...`);
      //     await wait(TWILIO_CALL_DELAY_MS);
      //   }
      //   return triggerVoiceAlert({
      //     battingTeam,
      //     runs: score.runs,
      //     wickets: score.wickets,
      //     overs: score.overs
      //   });
      // })().then(({ status, results }) => {
      //   saveFirstOverSessionEvent({
      //     matchId: id,
      //     matchLabel: label,
      //     innings: score.innings,
      //     battingTeam: battingTeam,
      //     score: score,
      //     notified: true,
      //     action: 'twilio_alert_finished',
      //     twilioStatus: status,
      //     twilioError: status === 'FAILED' ? new Error(JSON.stringify(results)) : null
      //   }).catch(() => {});
      // }).catch((err) => {
      //   logger.error(`Twilio voice call triggers failed completely for ${label}`, err);
      //   saveFirstOverSessionEvent({
      //     matchId: id,
      //     matchLabel: label,
      //     innings: score.innings,
      //     battingTeam: battingTeam,
      //     score: score,
      //     notified: true,
      //     action: 'twilio_alert_error',
      //     twilioStatus: 'FAILED',
      //     twilioError: err
      //   }).catch(() => {});
      // });
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
        `Poll #${pollCount} — ${matchIds.length} total matches, ${liveT20Count} live tracked matches, ${liveMatches.length} with scores`
      );
    }

    // Every 150 polls (approx 5 minutes at 2s interval), run a sweep of orphaned tricks
    if (pollCount % 150 === 0) {
      sweepOrphanedTricks(matchIds, sendTelegramReply).catch((err) => {
        logger.error('Error during orphaned tricks sweep:', err);
      });
    }
  } catch (err) {
    // If an unexpected error occurred during tick, apply backoff too just in case
    currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL);
    logger.error(`❌ [Poll #${pollCount}] Unexpected error in tick:`, err);
  } finally {
    // Schedule the next tick recursively
    setTimeout(tick, currentInterval);
  }
}

// ── Bootstrap ───────────────────────────────────────────
async function main() {
  validateEnv();

  const mode = TEST_MODE ? '🧪 TEST MODE' : '🏏 PRODUCTION';
  logger.info(`${mode} — Cricket Wicket Alert System starting...`);
  logger.info(`Polling every ${BASE_INTERVAL / 1000}s`);
  if (TEST_MODE) {
    logger.info(`Sending live scoreboard to group every ${TEST_SEND_EVERY * BASE_INTERVAL / 1000}s`);
  }
  logger.info('Watching: ALL live matches, first over wickets only');
  logger.info(`Alert to chat: "${process.env.TELEGRAM_CHAT_ID}"`);

  // Initialise MongoDB
  await initDB();

  // Load Team Name Mapping (Memory -> MongoDB -> CREX)
  await initTeamResolver();

  // ── Render Web Service Support (Dummy Server) ─────────
  const app = express();
  const port = process.env.PORT || 3000;
  
  // Basic root endpoint
  app.get('/', (req, res) => res.send('Cricket Wicket Alert System is running!'));
  
  // Dedicated JSON Health Check Endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      mode: TEST_MODE ? 'TEST_MODE' : 'PRODUCTION'
    });
  });

  app.listen(port, () => {
    logger.info(`🌐 Health check server listening on port ${port}`);
  });

  // Initialise Telegram
  await initTelegram();

  // Twilio calling is disabled for now
  // initTwilio();

  logger.success('Telegram ready — starting poll loop...');

  // Start the recursive tick loop immediately (it will schedule subsequent ticks)
  tick();
}

main().catch((err) => {
  logger.error('Fatal error occurred during bootstrap', err);
  process.exit(1);
});
