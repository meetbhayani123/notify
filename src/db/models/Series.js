const mongoose = require('mongoose');

const seriesSchema = new mongoose.Schema({
  f_key: { type: String, required: true, unique: true },
  name: String,
  shortName: String
});

module.exports = mongoose.model('Series', seriesSchema);
