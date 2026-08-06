const mongoose = require('mongoose');
const Account = require('../../models/account');
const Transaction = require('../../models/transaction');

// Net worth (all accounts, on- and off-budget) as of the end of each of the
// last `months` calendar months — a running balance, not a stored snapshot.
async function netWorth({ months = 12, ownerId } = {}) {
    const accounts = await Account.find({ owner: ownerId }).exec();
    const startingTotal = accounts.reduce((sum, a) => sum + a.startingBalanceCents, 0);

    // .aggregate() bypasses Mongoose's usual query-side ObjectId casting —
    // req.authUserId round-trips through the session store's JSON
    // serialization as a plain string, so this needs an explicit cast.
    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
    const now = new Date();
    const points = [];
    for (let i = months - 1; i >= 0; i--) {
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
        const [agg] = await Transaction.aggregate([
            { $match: { owner: ownerObjectId, date: { $lt: end } } },
            { $group: { _id: null, total: { $sum: '$amountCents' } } }
        ]);
        const monthLabel = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
        points.push({ month: monthLabel, netWorthCents: startingTotal + (agg ? agg.total : 0) });
    }
    return points;
}

module.exports = netWorth;
