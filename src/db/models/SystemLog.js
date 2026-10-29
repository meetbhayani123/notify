const mongoose = require('mongoose');
const { LOG_RETENTION_DAYS } = require('../../config');

const systemLogSchema = new mongoose.Schema({
  level: { type: String, required: true },
  message: { type: String, required: true },
  errorDetails: { type: String, default: null }
}, { timestamps: true });

// MongoDB's TTL monitor removes a log once it reaches LOG_RETENTION_DAYS, so
// this collection has a hard ceiling no matter how long the process runs.
systemLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: LOG_RETENTION_DAYS * 24 * 60 * 60 }
);

module.exports = mongoose.model('SystemLog', systemLogSchema);
