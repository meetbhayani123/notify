const mongoose = require('mongoose');

const systemLogSchema = new mongoose.Schema({
  level: { type: String, required: true },
  message: { type: String, required: true },
  errorDetails: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('SystemLog', systemLogSchema);
