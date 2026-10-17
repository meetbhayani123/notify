const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  f_key: { type: String, required: true, unique: true },
  name: String
});

module.exports = mongoose.model('Player', playerSchema);
