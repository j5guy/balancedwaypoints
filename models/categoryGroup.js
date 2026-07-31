const mongoose = require('mongoose');

const categoryGroupSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, unique: true },
    // Income groups are excluded from envelope spending math and shown
    // separately in the budget view.
    isIncome: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('CategoryGroup', categoryGroupSchema);
