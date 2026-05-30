# 🏏 Cricket Wicket Alert System

Real-time **Telegram** notifications for live cricket match events — first-over wickets, trick strategies, and more.

## Features

- 🔔 **First-Over Wicket Alerts** — instant notification when a wicket falls in the 1st over
- 🎯 **Wicket Trick Tracker** — monitors if another wicket falls within 4 overs (Done ✅ / Fail ❌)
- 📊 **Over Runs Trick** — alerts when 1st over runs exceed threshold (T20 only)
- 🏏 **2nd Over Wicket Trick** — detects first wicket in the 2nd over, tracks next wicket before 5th over
- 💾 **MongoDB Persistence** — state survives restarts, no duplicate alerts
- 🧪 **Test Mode** — sends live scoreboard summaries for verification
- 🌐 **Health Check Server** — Express endpoint for Render/cloud deployment

## How It Works

1. Polls the GoScorer live cricket API every 2 seconds
2. Filters for all live matches (any format)
3. Runs multiple detection strategies in parallel
4. Sends formatted alerts to Telegram groups/channels
5. Tracks trick outcomes via MongoDB with in-memory fallback

---

## Project Structure

```
notify/
├── .env.example              ← Environment variable template
├── .gitignore
├── package.json
├── README.md
└── src/
    ├── index.js              ← Slim bootstrap (~45 lines)
    ├── config/
    │   └── index.js          ← All constants, thresholds, env validation
    ├── api/
    │   ├── poller.js         ← HTTP fetch from cricket API
    │   └── teamResolver.js   ← Team key → name resolution (Memory/DB/Web)
    ├── services/
    │   ├── telegram.js       ← Telegram Bot API client (DRY sendToChat)
    │   └── twilio.js         ← Twilio voice alerts (disabled by default)
    ├── strategies/
    │   ├── firstOverWicket.js    ← 1st over wicket detection + alerts
    │   ├── wicketTrick.js        ← Post-wicket trick tracker (Done/Fail)
    │   ├── overRunsTrick.js      ← 1st over runs threshold trick
    │   └── secondOverWicket.js   ← 2nd over wicket detection + trick
    ├── db/
    │   ├── connection.js         ← MongoDB connection + fallback flag
    │   ├── matchStateStore.js    ← Wicket state tracking CRUD
    │   ├── sessionStore.js       ← First over session events CRUD
    │   ├── wicketTrickStore.js   ← Wicket trick sessions CRUD
    │   ├── overRunsTrickStore.js ← Over runs trick CRUD
    │   ├── secondOverWicketStore.js ← 2nd over trick CRUD
    │   └── models/
    │       ├── MatchState.js
    │       ├── FirstOverSession.js
    │       ├── WicketTrick.js
    │       ├── OverRunsTrick.js
    │       ├── SecondOverWicketTrick.js
    │       ├── SystemLog.js
    │       └── Team.js
    ├── helpers/
    │   ├── matchHelpers.js   ← isMatchFinished, isT20Match, formatScore
    │   ├── scoreParser.js    ← Score string parsing
    │   └── matchFilter.js    ← Live match filtering + labels
    ├── core/
    │   ├── pollLoop.js       ← Main polling loop + strategy orchestration
    │   └── server.js         ← Express health check server
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
- `TELEGRAM_CHAT_ID` — Target chat/group ID for alerts
- `CRICKET_API_URL` — GoScorer API endpoint
- `CRICKET_API_JWT` — API authentication token
- `MONGODB_URI` — MongoDB Atlas connection string

### 3. Run

```bash
npm start
```

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

---

*Data sourced from the GoScorer API (crex.com).*
