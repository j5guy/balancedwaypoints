const mongoose = require('mongoose');

const categoryGroupSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    // Income groups are excluded from envelope spending math and shown
    // separately in the budget view.
    isIncome: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

categoryGroupSchema.index({ owner: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('CategoryGroup', categoryGroupSchema);
