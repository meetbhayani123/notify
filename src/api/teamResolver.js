/**
 * api/teamResolver.js
 * Resolves internal team keys (e.g. "K") to their actual names (e.g. "RCB").
 * Also scrapes and caches series (tournament) and venue data from the same
 * CREX homepage payload.
 *
 * Uses a multi-layer caching strategy:
 * 1. Memory cache (instant)
 * 2. MongoDB (persistent across restarts)
 * 3. CREX Web Scrape (fallback if unknown key encountered)
 */

const axios = require('axios');
const mongoose = require('mongoose');
const Team = require('../db/models/Team');
const Series = require('../db/models/Series');
const Venue = require('../db/models/Venue');
const logger = require('../lib/logger');

const teamCache = {};
const seriesCache = {};
const venueCache = {};
let isFetchingWeb = false;

/**
 * Force fetch all teams, series, and venues from CREX homepage and upsert to MongoDB.
 */
async function fetchMappingsFromWeb() {
  if (isFetchingWeb) return;
  isFetchingWeb = true;

  try {
    logger.info('🌐 Fetching fresh team/series/venue mappings from CREX...');
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

    if (!mappingKey || !data[mappingKey]) {
      logger.warn('Could not find getHomeMapData in crex.com payload');
      isFetchingWeb = false;
      return;
    }

    const payload = data[mappingKey];
    const dbReady = mongoose.connection.readyState === 1;

    // ── Teams ──────────────────────────────────────────
    if (payload.t && Array.isArray(payload.t)) {
      const teamOps = [];
      for (const t of payload.t) {
        teamCache[t.f_key] = { name: t.n, shortName: t.sn };
        if (dbReady) {
          teamOps.push({
            updateOne: {
              filter: { f_key: t.f_key },
              update: { $set: { name: t.n, shortName: t.sn } },
              upsert: true
            }
          });
        }
      }
      if (teamOps.length > 0) await Team.bulkWrite(teamOps);
      logger.success(`Synced ${payload.t.length} teams from web`);
    }

    // ── Series (Tournaments) ───────────────────────────
    if (payload.s && Array.isArray(payload.s)) {
      const seriesOps = [];
      for (const s of payload.s) {
        seriesCache[s.f_key] = { name: s.n, shortName: s.sn };
        if (dbReady) {
          seriesOps.push({
            updateOne: {
              filter: { f_key: s.f_key },
              update: { $set: { name: s.n, shortName: s.sn } },
              upsert: true
            }
          });
        }
      }
      if (seriesOps.length > 0) await Series.bulkWrite(seriesOps);
      logger.success(`Synced ${payload.s.length} series from web`);
    }

    // ── Venues ─────────────────────────────────────────
    if (payload.v && Array.isArray(payload.v)) {
      const venueOps = [];
      for (const v of payload.v) {
        venueCache[v.f_key] = { name: v.n };
        if (dbReady) {
          venueOps.push({
            updateOne: {
              filter: { f_key: v.f_key },
              update: { $set: { name: v.n } },
              upsert: true
            }
          });
        }
      }
      if (venueOps.length > 0) await Venue.bulkWrite(venueOps);
      logger.success(`Synced ${payload.v.length} venues from web`);
    }
  } catch (err) {
    logger.error('Failed to fetch mappings from web:', err);
  } finally {
    isFetchingWeb = false;
  }
}

/**
 * Preload all caches from MongoDB on startup.
 */
async function initTeamResolver() {
  if (mongoose.connection.readyState === 1) {
    try {
      // Load teams
      const teams = await Team.find({});
      teams.forEach(t => {
        teamCache[t.f_key] = { name: t.name, shortName: t.shortName };
      });
      logger.info(`🗄️ Loaded ${teams.length} teams from MongoDB`);

      // Load series
      const seriesList = await Series.find({});
      seriesList.forEach(s => {
        seriesCache[s.f_key] = { name: s.name, shortName: s.shortName };
      });
      logger.info(`🗄️ Loaded ${seriesList.length} series from MongoDB`);

      // Load venues
      const venues = await Venue.find({});
      venues.forEach(v => {
        venueCache[v.f_key] = { name: v.name };
      });
      logger.info(`🗄️ Loaded ${venues.length} venues from MongoDB`);

      // If empty, fetch from web
      if (teams.length === 0 || seriesList.length === 0) {
        await fetchMappingsFromWeb();
      }
    } catch (err) {
      logger.error('Failed to load caches from DB:', err);
    }
  } else {
    await fetchMappingsFromWeb();
  }
}

// ── Generic key resolver ────────────────────────────────
async function resolveKey(key, memoryCache, Model, label) {
  // 1. Memory
  if (memoryCache[key]) return memoryCache[key];

  // 2. DB
  if (mongoose.connection.readyState === 1) {
    try {
      const doc = await Model.findOne({ f_key: key });
      if (doc) {
        const entry = { name: doc.name, shortName: doc.shortName };
        memoryCache[key] = entry;
        return entry;
      }
    } catch {}
  }

  // 3. Web scrape fallback
  logger.warn(`Unknown ${label} key "${key}". Triggering web scrape...`);
  await fetchMappingsFromWeb();
  return memoryCache[key] || null;
}

/**
 * Resolves a team key to its short name (or full name as fallback).
 */
async function resolveTeamName(teamKey) {
  const entry = await resolveKey(teamKey, teamCache, Team, 'team');
  return entry ? (entry.shortName || entry.name || teamKey) : teamKey;
}

/**
 * Resolves a team key to its FULL name (e.g. "Royal Challengers Bengaluru").
 */
async function resolveTeamFullName(teamKey) {
  const entry = await resolveKey(teamKey, teamCache, Team, 'team');
  return entry ? (entry.name || entry.shortName || teamKey) : teamKey;
}

/**
 * Resolves a series key to its full name (e.g. "Indian Premier League 2026").
 * The match object stores this as `q` (with a `^` prefix).
 */
async function resolveSeriesName(seriesKey) {
  const cleanKey = seriesKey ? seriesKey.replace(/^\^/, '') : null;
  if (!cleanKey) return null;
  const entry = await resolveKey(cleanKey, seriesCache, Series, 'series');
  return entry ? (entry.name || entry.shortName || cleanKey) : cleanKey;
}

/**
 * Resolves a series key to its short name (e.g. "IPL 2026").
 */
async function resolveSeriesShortName(seriesKey) {
  const cleanKey = seriesKey ? seriesKey.replace(/^\^/, '') : null;
  if (!cleanKey) return null;
  const entry = await resolveKey(cleanKey, seriesCache, Series, 'series');
  return entry ? (entry.shortName || entry.name || cleanKey) : cleanKey;
}

/**
 * Resolves a venue key to its name (e.g. "Wankhede Stadium, Mumbai").
 */
async function resolveVenueName(venueKey) {
  if (!venueKey) return null;
  const entry = await resolveKey(venueKey, venueCache, Venue, 'venue');
  return entry ? (entry.name || venueKey) : venueKey;
}

/**
 * Resolves all extra info for a match object in one call.
 * Returns { teamAShort, teamBShort, teamAFull, teamBFull, seriesName, seriesShortName, venue, format }.
 */
async function resolveMatchInfo(match) {
  const [teamAShort, teamBShort, teamAFull, teamBFull, seriesName, seriesShortName, venue] = await Promise.all([
    resolveTeamName(match.b),
    resolveTeamName(match.c),
    resolveTeamFullName(match.b),
    resolveTeamFullName(match.c),
    resolveSeriesName(match.q),
    resolveSeriesShortName(match.q),
    resolveVenueName(match.v)
  ]);

  return {
    teamAShort,
    teamBShort,
    teamAFull,
    teamBFull,
    seriesName,
    seriesShortName,
    venue,
    format: match.fo || 'Match'
  };
}

module.exports = {
  initTeamResolver,
  resolveTeamName,
  resolveTeamFullName,
  resolveSeriesName,
  resolveSeriesShortName,
  resolveVenueName,
  resolveMatchInfo
};
