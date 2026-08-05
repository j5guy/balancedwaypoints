const Transaction = require('../../models/transaction');

// Single-period income/expense totals, transfers excluded — same rules as
// incomeVsExpense.js, just collapsed to one total instead of grouped by
// month. Powers the dashboard's Summary/Total Income/Total Expense/Net
// Budget widgets (and their Grafana equivalents) without a separate query
// per widget.
async function summary({ from, to }) {
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    const match = { transferAccount: null, ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}) };

    const [agg] = await Transaction.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                totalIncomeCents: { $sum: { $cond: [{ $gt: ['$amountCents', 0] }, '$amountCents', 0] } },
                totalExpenseCents: { $sum: { $cond: [{ $lt: ['$amountCents', 0] }, '$amountCents', 0] } }
            }
        }
    ]);

    const totalIncomeCents = agg ? agg.totalIncomeCents : 0;
    const totalExpenseCents = agg ? agg.totalExpenseCents : 0;
    return { totalIncomeCents, totalExpenseCents, netCents: totalIncomeCents + totalExpenseCents };
}

module.exports = summary;
