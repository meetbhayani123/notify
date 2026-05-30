const mongoose = require('mongoose');

const matchStateSchema = new mongoose.Schema({
  matchId: { type: String, required: true, unique: true },
  wickets: { type: Number, default: 0 },
  overs: { type: Number, default: 0 },
  notified: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('MatchState', matchStateSchema);
