const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const Account = require('../../models/account');

// Monthly income (positive amounts) vs. expense (negative amounts) totals,
// transfers excluded (a transfer nets to zero across accounts and isn't
// real income/spending). Off-budget accounts (models/account.js's onBudget)
// are excluded too — those are asset/tracking accounts (investments, homes,
// vehicles, etc.) whose balance changes are net-worth movements, not real
// income or spending, and they already feed the Net Worth report instead
// (services/reports/netWorth.js).
async function incomeVsExpense({ from, to, ownerId }) {
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    // .aggregate() bypasses Mongoose's usual query-side ObjectId casting —
    // req.authUserId round-trips through the session store's JSON
    // serialization as a plain string, so this needs an explicit cast.
    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
    const onBudgetAccountIds = (await Account.find({ owner: ownerObjectId, onBudget: true }).select('_id').exec())
        .map(a => a._id);
    const match = {
        owner: ownerObjectId,
        transferAccount: null,
        account: { $in: onBudgetAccountIds },
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {})
    };

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
