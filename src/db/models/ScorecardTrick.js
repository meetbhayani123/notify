const mongoose = require('mongoose');

const scorecardTrickSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  innings: { type: Number, required: true },
  trick: { type: String, required: true },
  battingTeam: { type: String, default: null },
  playerName: { type: String, default: null },
  summary: { type: String, default: null },
  notified: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['NOTIFIED', 'SKIPPED', 'SEND_FAILED'],
    default: 'SKIPPED'
  }
}, { timestamps: true });

scorecardTrickSchema.index({ matchId: 1, innings: 1, trick: 1 }, { unique: true });

module.exports = mongoose.model('ScorecardTrick', scorecardTrickSchema);
