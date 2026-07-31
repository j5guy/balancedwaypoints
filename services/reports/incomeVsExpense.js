const Transaction = require('../../models/transaction');

// Monthly income (positive amounts) vs. expense (negative amounts) totals,
// transfers excluded (a transfer nets to zero across accounts and isn't
// real income/spending).
async function incomeVsExpense({ from, to }) {
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    const match = { transferAccount: null, ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}) };

    const rows = await Transaction.aggregate([
        { $match: match },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$date' } },
                incomeCents: { $sum: { $cond: [{ $gt: ['$amountCents', 0] }, '$amountCents', 0] } },
                expenseCents: { $sum: { $cond: [{ $lt: ['$amountCents', 0] }, '$amountCents', 0] } }
            }
        },
        { $sort: { _id: 1 } }
    ]);

    return rows.map(r => ({ month: r._id, incomeCents: r.incomeCents, expenseCents: r.expenseCents }));
}

module.exports = incomeVsExpense;
