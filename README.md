# 🏏 Cricket Wicket Alert System

Real-time WhatsApp **group** notifications when a wicket falls in the **first over** of any live T20/T20I match.

## How It Works

1. Polls the GoScorer live cricket API every 2 seconds
2. Filters for live T20 & T20I matches only
3. Detects wickets in the 1st over by comparing state across polls
4. Sends a formatted alert to your WhatsApp group
5. Never sends duplicate alerts (one per match, per innings)

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure `.env`

Edit the `.env` file:

```env
# Name of your WhatsApp group (must match exactly)
WHATSAPP_GROUP_NAME=Cricket Alerts

# Cricket API (pre-configured, no changes needed)
CRICKET_API_URL=https://api.goscorer.com/api/v3/getLiveMatches
CRICKET_API_JWT=eyJhbGci...
CRICKET_COUNTRY_CODE=IN

# Poll interval (ms) — minimum 1000
POLL_INTERVAL_MS=2000
```

### 3. First run — link WhatsApp

```bash
npm start
```

On the **first run**, a QR code appears in the terminal. Scan it with your phone:

1. Open WhatsApp → **Settings** → **Linked Devices**
2. Tap **Link a Device**

# MongoDB URI for tracking alerts
MONGODB_URI=mongodb+srv://...
```

### 3. Project Structure

```text
notify/
├── .env                  ← environment variables
├── .gitignore
├── package.json
├── README.md
└── src/
    ├── index.js          ← entry point, main poll loop
    ├── poller.js         ← HTTP fetch from cricket API
    ├── matchFilter.js    ← isLiveMatch() and matchLabel()
    ├── scoreParser.js    ← parseScore() and getCurrentInningsScore()
    ├── stateManager.js   ← MongoDB-based wicket tracking
    └── notifier.js       ← Telegram bot sender
```

---

## Running 24/7 with PM2

```bash
# Install PM2
npm install -g pm2

# Start
pm2 start src/index.js --name cricket-alert

# Auto-restart on reboot
pm2 save
pm2 startup

# View logs
pm2 logs cricket-alert

# Stop
pm2 stop cricket-alert
```

---

## ☁️ Deploying to Render

This app is designed to run easily on [Render](https://render.com/).

### 1. Create a Web Service
- Connect your GitHub repository to Render.
- Create a new **Web Service**.
- **Environment:** `Node`
- **Build Command:** `npm install`
- **Start Command:** `npm start`

### 2. Configure Environment Variables
Add the following under **Environment Variables** in Render:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `CRICKET_API_URL`
- `CRICKET_API_JWT`
- `CRICKET_COUNTRY_CODE` (e.g. `IN`)
- `TEST_MODE` (`true` or `false`)
- `MONGODB_URI` (Your MongoDB Atlas connection string for persistence)

*(Note: The app spins up a lightweight health check server on `$PORT` automatically so Render doesn't kill it.)*

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Chat not found | Ensure `TELEGRAM_CHAT_ID` is correct and the bot is an admin in the group. |
| API timeout | The GoScorer API may be temporarily down. The app auto-retries. |
| Duplicate alerts | Ensure `MONGODB_URI` is correctly configured so state persists across restarts. |

---

*Data sourced from the GoScorer API (crex.com).*
