# 🏏 Cricket Wicket Alert System

Real-time **Telegram** notifications for live cricket match events — first-over wickets, scorecard-based tricks, and more.

## Alerts & Tricks

| Trick | Formats | Innings | Fires when | Channel |
|-------|---------|---------|-----------|---------|
| **1st Over Wicket** | all | both | a wicket falls in the 1st over | main |
| **Wicket Trick** | all | both | follows a 1st-over wicket: another wicket within 4 overs → Done ✅ / Fail ❌ | main (reply) |
| **1st Over Runs** | T20 | both | 1st-over runs reach the threshold (1st inn ≥ 14, 2nd inn ≥ 13) | trick |
| **Death Overs Wicket** | T20 | 2nd | exactly 4 wickets down after 16 overs | trick |
| **Captain Top Scorer** | T20 | 1st | 1st innings ends and no other batter out-scored the captain | trick |
| **Keeper Not Out** | T20 + ODI | 1st | 1st innings ends with the wicketkeeper unbeaten | trick |
| **Keeper Top Scorer** | T20 + ODI | 1st | 1st innings ends and no other batter out-scored the keeper | trick |
| **Opener High SR** | ODI | 1st | an opener is dismissed with SR 101+ (checked directly upon out, without waiting for both) | trick |
| **Captain Out Slow** | T20 | both | the captain is dismissed below 100 SR having faced 10+ balls | trick |

A joint-highest score still counts as top-scoring. Every trick is evaluated **once** per match
and innings and recorded in MongoDB, so restarts never duplicate an alert.

## How It Works

1. Polls the GoScorer live cricket API every 2 seconds for all live matches
2. Runs the score-driven strategies on every tick (wickets, over runs, death overs)
3. Fetches the **full scorecard** for a match only when a scorecard trick is actually
   outstanding — then caches it, so this costs a handful of requests per match, not one per poll
4. Sends formatted alerts to the Telegram main and trick channels
5. Tracks every outcome in MongoDB, with an in-memory fallback when no database is configured

## Data Sources

All three endpoints are the ones crex.com itself calls:

| Purpose | Request | Auth |
|---------|---------|------|
| Live matches | `GET api.goscorer.com/api/v3/getLiveMatches` | `authorization: <CRICKET_API_JWT>` |
| Full scorecard | `GET api.goscorer.com/api/v3/getSC4?key=<matchId>` | none |
| Player names | `POST oc.crickapi.com/mapping/getHomeMapData`, header `type: liveparsing`, body `{"p":[keys],"s":[],"u":[],"v":[],"t":[],"lc":"en"}` | none |
| Teams / series / venues / match slugs | scraped from the `app-root-state` JSON on `crex.com` | none |

The scorecard response is an array of innings. The fields this project relies on are
documented in [`src/helpers/scorecardParser.js`](src/helpers/scorecardParser.js) — most
importantly `x` (`"<captainKey>/<wicketKeeperKey>"`) and `b` (the batting card in batting
order, carrying runs, balls, boundaries and dismissal details).

---

## Project Structure

```
notify/
├── .env.example              ← Environment variable template
├── package.json
├── README.md
├── frontend/                 ← Next.js dashboard for muting series
│   └── app/
│       ├── page.js           ← Series list, search, filters, bulk mute
│       ├── layout.js
│       └── globals.css
└── src/
    ├── index.js              ← Slim bootstrap
    ├── config/
    │   └── index.js          ← All constants, thresholds, env validation
    ├── api/
    │   ├── poller.js         ← HTTP fetch of live matches
    │   ├── scorecard.js      ← Per-match scorecard fetch + TTL cache
    │   ├── teamResolver.js   ← Team / series / venue / match-slug resolution
    │   ├── playerResolver.js ← Player key → name (Memory/DB/Web, negative cached)
    │   └── seriesRoutes.js   ← REST API used by the frontend
    ├── services/
    │   ├── telegram.js       ← Telegram Bot API client (DRY sendToChat)
    │   └── twilio.js         ← Twilio voice alerts (not currently wired up)
    ├── strategies/
    │   ├── firstOverWicket.js    ← 1st over wicket detection + alerts
    │   ├── wicketTrick.js        ← Post-wicket trick tracker (Done/Fail)
    │   ├── overRunsTrick.js      ← 1st over runs threshold trick
    │   ├── deathOversWicket.js   ← 4 wickets down after 16 overs (T20)
    │   └── scorecardTricks.js    ← Captain / keeper / openers tricks
    ├── db/
    │   ├── connection.js            ← MongoDB connection + fallback flag
    │   ├── matchStateStore.js       ← Wicket state tracking CRUD
    │   ├── sessionStore.js          ← First over session events CRUD
    │   ├── wicketTrickStore.js      ← Wicket trick sessions CRUD
    │   ├── overRunsTrickStore.js    ← Over runs trick CRUD
    │   ├── deathOversWicketStore.js ← Death overs trick CRUD
    │   ├── scorecardTrickStore.js   ← Once-only bookkeeping for scorecard tricks
    │   └── models/
    │       ├── MatchState.js       ├── OverRunsTrick.js
    │       ├── FirstOverSession.js ├── DeathOversWicketTrick.js
    │       ├── WicketTrick.js      ├── ScorecardTrick.js
    │       ├── SystemLog.js        ├── Team.js
    │       ├── Series.js           ├── Venue.js
    │       └── Player.js
    ├── helpers/
    │   ├── matchHelpers.js          ← isMatchFinished, isT20Match, isODIMatch, formatScore
    │   ├── scoreParser.js           ← Live score string parsing
    │   ├── scorecardParser.js       ← Scorecard payload decoding (pure)
    │   ├── scorecardTrickRules.js   ← Scorecard trick rules (pure, no I/O)
    │   └── matchFilter.js           ← Live match filtering, series muting, labels
    ├── core/
    │   ├── pollLoop.js       ← Main polling loop + strategy orchestration
    │   └── server.js         ← Express health check + series API
    └── lib/
        └── logger.js         ← Centralized ANSI color logger + DB logging
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure `.env`

Copy the template and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `TELEGRAM_BOT_TOKEN` — Your Telegram bot token
- `TELEGRAM_CHAT_ID` — Target chat/group ID for main alerts
- `TELEGRAM_TRICK_CHAT_ID` — Target chat/channel ID for trick alerts (defaults to `TELEGRAM_CHAT_ID`)
- `CRICKET_API_URL` — GoScorer live matches endpoint
- `CRICKET_API_JWT` — API authentication token
- `MONGODB_URI` — MongoDB Atlas connection string

### 3. Run

```bash
npm start
```

### 4. Frontend (optional)

```bash
cd frontend && npm install && npm run dev
```

Set `NEXT_PUBLIC_API_URL` to the backend's URL. Write endpoints are protected by
`API_KEY` on the backend, and `CORS_ORIGINS` controls which origins may call it —
set **both** in production, since each one defaults to allow-all when unset.

---

## Running 24/7 with PM2

```bash
npm install -g pm2
pm2 start src/index.js --name cricket-alert
pm2 save && pm2 startup
pm2 logs cricket-alert
```

---

## Deploying to Render

1. Create a **Web Service** connected to your GitHub repo
2. **Build Command:** `npm install`
3. **Start Command:** `npm start`
4. Add environment variables in Render dashboard
5. The app auto-binds to `$PORT` with a health check endpoint

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Chat not found | Ensure `TELEGRAM_CHAT_ID` is correct and the bot is an admin in the group |
| API timeout | The GoScorer API may be temporarily down — the app auto-retries with backoff |
| Duplicate alerts | Ensure `MONGODB_URI` is configured so state persists across restarts |
| No captain/keeper alerts | Those tricks need the scorecard's `x` field; a match missing it is skipped and logged |

---

*Data sourced from the GoScorer API (crex.com).*
