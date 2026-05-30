/**
 * db/connection.js
 * Manages the MongoDB connection lifecycle.
 * Falls back to in-memory tracking when no URI is provided.
 */

const mongoose = require('mongoose');

let dbConnected = false;

async function initDB() {
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      dbConnected = true;
    } catch (err) {
      console.error('MongoDB Connection Error:', err.message);
      console.warn('Falling back to in-memory tracking.');
    }
  } else {
    console.warn('No MONGODB_URI provided in .env. Using in-memory state (alerts may duplicate on restart).');
  }
  return dbConnected;
}

function isDbConnected() {
  return dbConnected;
}

module.exports = { initDB, isDbConnected };
