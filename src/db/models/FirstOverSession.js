const mongoose = require('mongoose');

const firstOverEventSchema = new mongoose.Schema({
  createdAt: { type: Date, default: Date.now },
  overs: { type: Number, required: true },
  runs: { type: Number, required: true },
  wickets: { type: Number, required: true },
  balls: { type: Number, required: true },
  action: { type: String, required: true },
  notified: { type: Boolean, required: true }
});

const firstOverSessionSchema = new mongoose.Schema({
  matchId: { type: String, required: true },
  matchLabel: { type: String, required: true },
  innings: { type: Number, required: true },
  battingTeam: { type: String, required: true },
  notified: { type: Boolean, default: false },
  notifiedAt: { type: Date, default: null },
  alertTriggerScore: { type: String, default: null },
  telegramAlertStatus: { type: String, enum: ['NONE', 'SUCCESS', 'FAILED'], default: 'NONE' },
  telegramError: { type: String, default: null },
  events: [firstOverEventSchema]
}, { timestamps: true });

firstOverSessionSchema.index({ matchId: 1, innings: 1 }, { unique: true });

module.exports = mongoose.model('FirstOverSession', firstOverSessionSchema);
