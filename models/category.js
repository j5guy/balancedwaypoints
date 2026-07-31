const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'CategoryGroup', required: true },
    sortOrder: { type: Number, default: 0 },
    archived: { type: Boolean, default: false }
}, { timestamps: true });

categorySchema.index({ group: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Category', categorySchema);
