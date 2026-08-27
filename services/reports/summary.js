const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const Account = require('../../models/account');

// Single-period income/expense totals, transfers excluded — same rules as
// incomeVsExpense.js, just collapsed to one total instead of grouped by
// month. Powers the dashboard's Summary/Total Income/Total Expense/Net
// Budget widgets (and their Grafana equivalents) without a separate query
// per widget. `accountId` is optional — omitted means "every account" (the
// dashboard's "All accounts" scope); the widget-instance model that carries
// this is documented on models/user.js's preferences.dashboard.widgets. When
// scoped to "every account", off-budget asset/tracking accounts are excluded
// the same way incomeVsExpense.js excludes them — a specific accountId is
// left alone since the caller picked that account deliberately.
async function summary({ from, to, accountId, ownerId }) {
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    // .aggregate() bypasses Mongoose's usual query-side ObjectId casting —
    // both owner and accountId arrive here as plain strings (session/query
    // param respectively), so both need an explicit cast or this silently
    // matches nothing.
    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
    let accountFilter = {};
    if (accountId) {
        accountFilter = { account: new mongoose.Types.ObjectId(accountId) };
    } else {
        const onBudgetAccountIds = (await Account.find({ owner: ownerObjectId, onBudget: true }).select('_id').exec())
            .map(a => a._id);
        accountFilter = { account: { $in: onBudgetAccountIds } };
    }
    const match = {
        owner: ownerObjectId,
        transferAccount: null,
        ...accountFilter,
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {})
    };

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
