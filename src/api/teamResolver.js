/**
 * api/teamResolver.js
 * Resolves internal team keys (e.g. "K") to their actual names (e.g. "RCB").
 * Uses a multi-layer caching strategy:
 * 1. Memory cache (instant)
 * 2. MongoDB (persistent across restarts)
 * 3. CREX Web Scrape (fallback if unknown team appears)
 */

const axios = require('axios');
const mongoose = require('mongoose');
const Team = require('../db/models/Team');
const logger = require('../lib/logger');

const memoryCache = {};
let isFetchingWeb = false;

/**
 * Force fetch all teams from CREX homepage and upsert to MongoDB.
 */
async function fetchTeamMappingFromWeb() {
  if (isFetchingWeb) return;
  isFetchingWeb = true;

  try {
    logger.info('🌐 Fetching fresh team mappings from CREX...');
    const response = await axios.get('https://crex.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const html = response.data;
    const match = html.match(/<script id="app-root-state" type="application\/json">([\s\S]*?)<\/script>/);

    if (!match) {
      logger.warn('Could not find app-root-state in crex.com HTML');
      isFetchingWeb = false;
      return;
    }

    const rawJson = match[1]
      .replace(/&q;/g, '"')
      .replace(/&s;/g, "'")
      .replace(/&l;/g, '<')
      .replace(/&g;/g, '>')
      .replace(/&a;/g, '&');

    const data = JSON.parse(rawJson);
    const mappingKey = Object.keys(data).find(k => k.includes('getHomeMapData'));

    if (mappingKey && data[mappingKey] && data[mappingKey].t) {
      const teams = data[mappingKey].t;

      const bulkOps = [];
      for (const t of teams) {
        memoryCache[t.f_key] = { name: t.n, shortName: t.sn };

        if (mongoose.connection.readyState === 1) {
          bulkOps.push({
            updateOne: {
              filter: { f_key: t.f_key },
              update: { $set: { name: t.n, shortName: t.sn } },
              upsert: true
            }
          });
        }
      }

      if (bulkOps.length > 0) {
        await Team.bulkWrite(bulkOps);
      }
      logger.success(`Synced ${teams.length} teams from web to cache/DB`);
    }
  } catch (err) {
    logger.error('Failed to fetch team mapping from web:', err);
  } finally {
    isFetchingWeb = false;
  }
}

/**
 * Preload memory cache from MongoDB on startup.
 */
async function initTeamResolver() {
  if (mongoose.connection.readyState === 1) {
    try {
      const teams = await Team.find({});
      teams.forEach(t => {
        memoryCache[t.f_key] = { name: t.name, shortName: t.shortName };
      });
      logger.info(`🗄️ Loaded ${teams.length} teams from MongoDB into memory cache`);

      if (teams.length === 0) {
        await fetchTeamMappingFromWeb();
      }
    } catch (err) {
      logger.error('Failed to load teams from DB:', err);
    }
  } else {
    await fetchTeamMappingFromWeb();
  }
}

/**
 * Resolves a team key asynchronously.
 * Checks memory → DB → Web.
 */
async function resolveTeamName(teamKey) {
  // 1. Check memory cache
  if (memoryCache[teamKey]) {
    return memoryCache[teamKey].shortName || memoryCache[teamKey].name || teamKey;
  }

  // 2. Check DB
  if (mongoose.connection.readyState === 1) {
    try {
      const dbTeam = await Team.findOne({ f_key: teamKey });
      if (dbTeam) {
        memoryCache[teamKey] = { name: dbTeam.name, shortName: dbTeam.shortName };
        return dbTeam.shortName || dbTeam.name || teamKey;
      }
    } catch {}
  }

  // 3. Fallback to Web Scrape (unknown team encountered!)
  logger.warn(`Unknown team key "${teamKey}" encountered. Triggering web scrape...`);
  await fetchTeamMappingFromWeb();

  if (memoryCache[teamKey]) {
    return memoryCache[teamKey].shortName || memoryCache[teamKey].name || teamKey;
  }

  return teamKey;
}

module.exports = { initTeamResolver, resolveTeamName };
