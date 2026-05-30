const mongoose = require('mongoose');

const overRunsTrickSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  innings: { type: Number, required: true },
  battingTeam: { type: String, required: true },
  runsAtFirstOver: { type: Number, default: null },
  ballsAtEvaluation: { type: Number, default: null },
  notified: { type: Boolean, default: false },
  status: { type: String, enum: ['PENDING', 'NOTIFIED', 'SKIPPED'], default: 'PENDING' }
}, { timestamps: true });

overRunsTrickSchema.index({ matchId: 1, innings: 1 }, { unique: true });

module.exports = mongoose.model('OverRunsTrick', overRunsTrickSchema);
