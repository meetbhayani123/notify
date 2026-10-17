/**
 * api/playerResolver.js
 * Resolves internal player keys (e.g. "ML") to real names (e.g. "Chadwick Walton").
 *
 * Same multi-layer strategy as teamResolver:
 *   1. Memory cache (instant)
 *   2. MongoDB (persistent across restarts)
 *   3. CREX mapping API — POST /mapping/getHomeMapData with the unknown keys
 *
 * Unknown keys are negative-cached for UNRESOLVED_TTL_MS so a player who is
 * genuinely missing upstream cannot trigger a request on every poll.
 */

const axios = require('axios');
const mongoose = require('mongoose');
const Player = require('../db/models/Player');
const { PLAYER_MAP_API_URL } = require('../config');
const logger = require('../lib/logger');

const playerCache = {};
// key → timestamp of the last failed lookup
const unresolved = new Map();
const UNRESOLVED_TTL_MS = 600_000; // 10 minutes

function isRecentlyUnresolved(key) {
  const at = unresolved.get(key);
  return !!at && Date.now() - at < UNRESOLVED_TTL_MS;
}

/**
 * Ask the CREX mapping API for a batch of player keys.
 * @param {string[]} keys
 * @returns {Promise<object>} key → name for everything that resolved
 */
async function fetchPlayerNames(keys) {
  const resolved = {};
  try {
    const response = await axios.post(
      PLAYER_MAP_API_URL,
      { p: keys, s: [], u: [], v: [], t: [], lc: 'en' },
      {
        timeout: 8000,
        headers: {
          'content-type': 'application/json',
          'type':         'liveparsing',
          'origin':       'https://crex.com',
          'referer':      'https://crex.com/',
          'accept':       'application/json, text/plain, */*'
        }
      }
    );

    const list = response.data && Array.isArray(response.data.p) ? response.data.p : [];
    for (const entry of list) {
      if (entry && entry.f_key && entry.n) resolved[entry.f_key] = entry.n;
    }
  } catch (err) {
    logger.warn(`Player mapping lookup failed for ${keys.length} key(s) — ${err.message}`);
  }
  return resolved;
}

/**
 * Persist resolved names so later restarts skip the network entirely.
 */
async function persistPlayers(resolved) {
  if (mongoose.connection.readyState !== 1) return;
  const ops = Object.entries(resolved).map(([f_key, name]) => ({
    updateOne: { filter: { f_key }, update: { $set: { name } }, upsert: true }
  }));
  if (ops.length === 0) return;
  try {
    await Player.bulkWrite(ops);
  } catch (err) {
    logger.error('Failed to persist player names:', err);
  }
}

/**
 * Resolve many player keys at once.
 *
 * @param {Array<string>} keys
 * @returns {Promise<object>} key → name (falls back to the key itself)
 */
async function resolvePlayerNames(keys) {
  const wanted = [...new Set((keys || []).filter(Boolean))];
  const out = {};
  const missing = [];

  // 1. Memory
  for (const key of wanted) {
    if (playerCache[key]) out[key] = playerCache[key];
    else missing.push(key);
  }

  // 2. MongoDB
  let stillMissing = missing;
  if (stillMissing.length > 0 && mongoose.connection.readyState === 1) {
    try {
      const docs = await Player.find({ f_key: { $in: stillMissing } }).lean();
      for (const doc of docs) {
        if (doc.name) {
          playerCache[doc.f_key] = doc.name;
          out[doc.f_key] = doc.name;
        }
      }
      stillMissing = stillMissing.filter(k => !out[k]);
    } catch (err) {
      logger.error('Failed to load player names from DB:', err);
    }
  }

  // 3. Mapping API — skipping keys that recently failed to resolve
  const askable = stillMissing.filter(k => !isRecentlyUnresolved(k));
  if (askable.length > 0) {
    const resolved = await fetchPlayerNames(askable);

    for (const [key, name] of Object.entries(resolved)) {
      playerCache[key] = name;
      out[key] = name;
      unresolved.delete(key);
    }
    for (const key of askable) {
      if (!resolved[key]) unresolved.set(key, Date.now());
    }

    await persistPlayers(resolved);
  }

  // Fall back to the raw key so messages always render something.
  for (const key of wanted) {
    if (!out[key]) out[key] = key;
  }
  return out;
}

/**
 * Resolve a single player key to a name.
 */
async function resolvePlayerName(key) {
  if (!key) return null;
  const map = await resolvePlayerNames([key]);
  return map[key] || key;
}

module.exports = { resolvePlayerNames, resolvePlayerName };
