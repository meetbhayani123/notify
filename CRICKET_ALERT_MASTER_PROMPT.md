# Cricket Wicket Alert System — Master Prompt for AI Code Editors
### (Cursor / Windsurf / GitHub Copilot / Continue.dev)

Paste this entire document as your **first message** in a new AI chat session inside your code editor.  
The AI will build every file from scratch with full context.

---

## YOUR TASK

Build a **Node.js application** that:
1. Continuously polls a live cricket scores API every 2 seconds
2. Detects when a **wicket falls in the first over** of **ALL LIVE MATCHES** (any format)
3. Instantly sends a **Telegram notification to a Group** using the Telegram Bot API (via Axios)
4. Never sends duplicate alerts (uses **MongoDB** via Mongoose to persist state)
5. Survives network errors without crashing
6. Includes a **TEST_MODE** that periodically sends a live scoreboard to the Telegram group.
7. Includes an **Express health check server** so it can be deployed as a Web Service on **Render**.

---

## TECH STACK

- **Runtime**: Node.js (v18+, uses no ESM — CommonJS only)
- **HTTP client**: `axios`
- **Database**: `mongoose` (MongoDB)
- **Config**: `dotenv`
- **Web Server**: `express` (for Render health check)

**Install command:**
```bash
npm install axios mongoose dotenv express
```

---

## DATA SOURCE — THE CRICKET API

### Endpoint
```
GET https://api.goscorer.com/api/v3/getLiveMatches
```

### Required Headers
```
authorization: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImV4cGlyZXNJbiI6IjM2NWQifQ.eyJ0aW1lIjoxNjYwMDQ2NjIwMDAwfQ.bTEmMWlR7hLRUHxPPq6-1TP7cuuW7m6sZ9jcdbYzLRA
cc: IN
origin: https://crex.com
referer: https://crex.com/
accept: application/json, text/plain, */*
user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36
```

### Response Shape
The API returns a **flat JSON object** where each key is an internal match ID:
```json
{
  "1196": {
    "d": 1,
    "b": "K",
    "c": "I",
    "j": "118/2(11.4",
    "k": "",
    "res": ""
  }
}
```

---

## CRITICAL: DECODING THE API FIELDS

| Field | Meaning | Example value | Notes |
|-------|---------|---------------|-------|
| `d` | Match status | `1` = live/upcoming · `2` = completed | Filter: monitor `d === 1` OR `d === 2` (innings break) |
| `b` | Team A ID | `"K"`, `"8X"` | Internal code |
| `c` | Team B ID | `"I"`, `"IL"` | Internal code |
| `j` | 1st innings score string | `"207/5(20.0"` | |
| `k` | 2nd innings score string | `"60/10(14.2"` | Empty string if not started |
| `res` | Result / live status text | `"Nepal won by 9 wickets"` | Empty when live and no break |

---

## SCORE STRING FORMAT — CRITICAL TO UNDERSTAND

The `j` and `k` fields contain scores in this exact format:
```
"runs/wickets(overs"
```
Note: **the closing bracket `)` is intentionally absent** in the raw API data.

### Parsing the overs value
The decimal part of overs is NOT a fraction — it is the **ball count** (1–6):
- `7.2` means 7 complete overs + 2 balls = 44 balls total.

### First over detection rule
A wicket is "in the first over" when the ball count is between 1 and 5.
At 0.6, the 6th ball is bowled, so the over is complete.

---

## PROJECT FILE STRUCTURE

Create exactly these files:

```
notify/
├── .env                  ← environment variables
├── .gitignore            
├── package.json
└── src/
    ├── index.js          ← entry point, main polling loop & express server
    ├── poller.js         ← HTTP fetch from cricket API
    ├── matchFilter.js    ← isLiveMatch() and matchLabel()
    ├── scoreParser.js    ← parseScore() and getCurrentInningsScore()
    ├── stateManager.js   ← MongoDB Mongoose models and state tracking
    └── notifier.js       ← Telegram API sender logic
```

---

## .env FILE

```env
TEST_MODE=true

# Telegram Bot Config
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_telegram_chat_id_here

# Cricket API
CRICKET_API_URL=https://api.goscorer.com/api/v3/getLiveMatches
CRICKET_API_JWT=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImV4cGlyZXNJbiI6IjM2NWQifQ.eyJ0aW1lIjoxNjYwMDQ2NjIwMDAwfQ.bTEmMWlR7hLRUHxPPq6-1TP7cuuW7m6sZ9jcdbYzLRA
CRICKET_COUNTRY_CODE=IN

POLL_INTERVAL_MS=2000

# MongoDB URI for state persistence
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/cricket?retryWrites=true&w=majority
```

---

## RENDER DEPLOYMENT

The app should be ready to deploy on **Render** as a Web Service.
1. Use `express` to bind to `process.env.PORT || 3000` with a simple health check `GET /`.
2. Connect to MongoDB Atlas so the `notified` state is preserved across Render restarts.

---

## FINAL CHECKLIST FOR AI

- [ ] `npm install` runs cleanly.
- [ ] Uses Telegram Bot API instead of WhatsApp.
- [ ] Wicket alert sends correctly for first-over wickets.
- [ ] MongoDB is used for state tracking so alerts aren't duplicated.
- [ ] Express server listens on `$PORT` so Render doesn't crash the deploy.
