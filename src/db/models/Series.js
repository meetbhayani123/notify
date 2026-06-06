const mongoose = require('mongoose');

const seriesSchema = new mongoose.Schema({
  f_key: { type: String, required: true, unique: true },
  name: String,
  shortName: String,
  muted: { type: Boolean, default: false }
});

module.exports = mongoose.model('Series', seriesSchema);
