const mongoose = require('mongoose');

const tightOverTrickSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  innings: { type: Number, required: true },
  over: { type: Number, required: true },
  battingTeam: { type: String, default: null },
  runs: { type: Number, required: true },
  wickets: { type: Number, required: true },
  notified: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['NOTIFIED', 'SKIPPED', 'SEND_FAILED'],
    default: 'SKIPPED'
  }
}, { timestamps: true });

tightOverTrickSchema.index({ matchId: 1, innings: 1, over: 1 }, { unique: true });

module.exports = mongoose.model('TightOverTrick', tightOverTrickSchema);
