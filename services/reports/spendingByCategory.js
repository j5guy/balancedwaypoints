const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const categoriesDb = require('../database/categories');

// Total outflow per category (direct + split lines) between two dates.
async function spendingByCategory({ from, to }) {
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

    return [...totals.entries()]
        .map(([categoryId, totalCents]) => ({ category: byId.get(categoryId) || null, categoryId, totalCents }))
        .filter(row => row.totalCents < 0) // spending only — inflows (refunds/income) excluded
        .sort((a, b) => a.totalCents - b.totalCents);
}

module.exports = spendingByCategory;
