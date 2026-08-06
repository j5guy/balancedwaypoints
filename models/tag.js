const mongoose = require('mongoose');

const tagSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true }
}, { timestamps: true });

tagSchema.index({ owner: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Tag', tagSchema);
