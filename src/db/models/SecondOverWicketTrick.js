const mongoose = require('mongoose');

const secondOverWicketTrickSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  innings: { type: Number, required: true },
  battingTeam: { type: String, required: true },
  telegramMessageId: { type: Number, required: true },
  initialWickets: { type: Number, required: true },
  wicketBalls: { type: Number, required: true },
  status: { type: String, enum: ['PENDING', 'DONE', 'FAIL'], default: 'PENDING' },
  resolved: { type: Boolean, default: false },
  completedAt: { type: Date, default: null }
}, { timestamps: true });

secondOverWicketTrickSchema.index({ matchId: 1, innings: 1 }, { unique: true });

module.exports = mongoose.model('SecondOverWicketTrick', secondOverWicketTrickSchema);
