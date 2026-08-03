const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const categoriesDb = require('../database/categories');
const categoryBudgetsDb = require('../database/categoryBudgets');

// Total outflow per category (direct + split lines) between two dates. When
// `month` ('YYYY-MM') is given, each row also gets that month's assignedCents
// so the caller can compare budgeted vs. actual — a CategoryBudget row only
// ever covers one exact calendar month, so this is meaningful specifically
// when from/to bound that same single month (the caller's job to ensure;
// this just attaches whatever's on record for `month`, unconditionally).
async function spendingByCategory({ from, to, month }) {
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    const match = Object.keys(dateFilter).length ? { date: dateFilter } : {};

    const [direct, splits] = await Promise.all([
        Transaction.aggregate([
            { $match: { ...match, category: { $ne: null } } },
            { $group: { _id: '$category', total: { $sum: '$amountCents' } } }
        ]),
        Transaction.aggregate([
            { $match: { ...match, 'splits.0': { $exists: true } } },
            { $unwind: '$splits' },
            { $group: { _id: '$splits.category', total: { $sum: '$splits.amountCents' } } }
        ])
    ]);

    const totals = new Map();
    [...direct, ...splits].forEach(row => {
        const key = String(row._id);
        totals.set(key, (totals.get(key) || 0) + row.total);
    });

    const categories = await categoriesDb.list({ includeArchived: true });
    const byId = new Map(categories.map(c => [String(c._id), c]));

    let assignedById = new Map();
    if (month) {
        const budgetRows = await categoryBudgetsDb.forMonth(month);
        assignedById = new Map(budgetRows.map(r => [String(r.category), r.assignedCents]));
    }

    return [...totals.entries()]
        .map(([categoryId, totalCents]) => ({
            category: byId.get(categoryId) || null,
            categoryId,
            totalCents,
            assignedCents: month ? (assignedById.get(categoryId) || 0) : null
        }))
        .filter(row => row.totalCents < 0) // spending only — inflows (refunds/income) excluded
        .sort((a, b) => a.totalCents - b.totalCents);
}

module.exports = spendingByCategory;
