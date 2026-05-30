/**
 * strategies/firstOverWicket.js
 * Detects first-over wickets, sends alerts, and creates WicketTrick sessions.
 */

const { checkForWicket, getMatchState } = require('../db/matchStateStore');
const { saveFirstOverSessionEvent } = require('../db/sessionStore');
const { createWicketTrick } = require('../db/wicketTrickStore');
const { sendTelegramAlert } = require('../services/telegram');
const { matchLabel } = require('../helpers/matchFilter');
const { resolveTeamName } = require('../api/teamResolver');
const logger = require('../lib/logger');

/**
 * Handles first-over wicket detection for a single match.
 * Includes live tracking logging, wicket detection, alert sending,
 * and WicketTrick session creation.
 *
 * @param {string} matchId
 * @param {object} score — parsed score from getCurrentInningsScore
 * @param {object} match — raw match object from the API
 */
async function handleFirstOverWicket(matchId, score, match) {
  // Resolve label + team name once — reused by both tracking and alert paths
  const label = await matchLabel(matchId, match);
  const battingTeam = await resolveTeamName(score.battingTeamKey);

  // Live Tracking Log for first over
  if (score.isFirstOver) {
    const dbState = await getMatchState(matchId);
    const notifiedStr = (dbState && dbState.notified) ? '✅ Alert Sent' : '⏳ Waiting for Wicket';
    logger.live(`${label} — Batting: ${battingTeam} (${score.innings === 1 ? '1st' : '2nd'} Innings) — ${score.runs}/${score.wickets} (${score.overs} ov) — [${notifiedStr}]`);

    saveFirstOverSessionEvent({
      matchId,
      matchLabel: label,
      innings: score.innings,
      battingTeam,
      score,
      notified: !!(dbState && dbState.notified),
      action: 'poll_received'
    }).catch(() => {});
  }

  const result = await checkForWicket(matchId, score);
  if (!result.wicketFell) return;

  logger.success(
    `WICKET in 1st over! ${label} — Batting: ${battingTeam} (${score.innings === 1 ? '1st' : '2nd'} Innings) — ${score.runs}/${score.wickets} (${score.overs} ov)`
  );

  // Save alert trigger to history
  saveFirstOverSessionEvent({
    matchId,
    matchLabel: label,
    innings: score.innings,
    battingTeam,
    score,
    notified: true,
    action: 'alert_triggered'
  }).catch(() => {});

  try {
    const telegramMessageId = await sendTelegramAlert({
      matchLabel: label,
      newWickets: result.newWickets,
      overs: score.overs,
      runs: score.runs,
      battingTeam,
      innings: score.innings
    });
    logger.success(`Telegram alert sent successfully for ${label} (Msg ID: ${telegramMessageId})`);

    if (telegramMessageId) {
      createWicketTrick({
        matchId,
        innings: score.innings,
        battingTeam,
        telegramMessageId,
        initialWickets: score.wickets
      }).catch((err) => {
        logger.error(`Failed to create Wicket Trick session for ${label}:`, err);
      });
    }

    saveFirstOverSessionEvent({
      matchId,
      matchLabel: label,
      innings: score.innings,
      battingTeam,
      score,
      notified: true,
      action: 'alert_success',
      telegramStatus: 'SUCCESS'
    }).catch(() => {});
  } catch (err) {
    logger.error(`Telegram send failed for ${label}`, err);

    saveFirstOverSessionEvent({
      matchId,
      matchLabel: label,
      innings: score.innings,
      battingTeam,
      score,
      notified: true,
      action: 'alert_failed',
      telegramStatus: 'FAILED',
      telegramError: err
    }).catch(() => {});
  }
}

module.exports = { handleFirstOverWicket };
