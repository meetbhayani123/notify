const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  f_key: { type: String, required: true, unique: true },
  name: String,
  shortName: String
});

module.exports = mongoose.model('Team', teamSchema);
