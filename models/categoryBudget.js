const mongoose = require('mongoose');

// One row per (category, month) — the amount assigned to that envelope that
// month. Category balances/rollover are computed on read from this plus
// Transaction totals (services/budget/envelope.js), never stored.
const categoryBudgetSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    // 'YYYY-MM'
    month: { type: String, required: true },
    assignedCents: { type: Number, default: 0 }
}, { timestamps: true });

categoryBudgetSchema.index({ owner: 1, category: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('CategoryBudget', categoryBudgetSchema);
