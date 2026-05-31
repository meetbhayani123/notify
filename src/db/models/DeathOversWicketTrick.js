const mongoose = require('mongoose');

const deathOversWicketTrickSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  innings: { type: Number, required: true },
  battingTeam: { type: String, required: true },
  runs: { type: Number, required: true },
  wickets: { type: Number, required: true },
  overs: { type: Number, required: true },
  notified: { type: Boolean, default: false },
  status: { type: String, enum: ['NOTIFIED', 'SKIPPED'], default: 'NOTIFIED' }
}, { timestamps: true });

deathOversWicketTrickSchema.index({ matchId: 1, innings: 1 }, { unique: true });

module.exports = mongoose.model('DeathOversWicketTrick', deathOversWicketTrickSchema);
