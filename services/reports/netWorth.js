const Account = require('../../models/account');
const Transaction = require('../../models/transaction');

// Net worth (all accounts, on- and off-budget) as of the end of each of the
// last `months` calendar months — a running balance, not a stored snapshot.
async function netWorth({ months = 12 } = {}) {
    const accounts = await Account.find().exec();
    const startingTotal = accounts.reduce((sum, a) => sum + a.startingBalanceCents, 0);

    const now = new Date();
    const points = [];
    for (let i = months - 1; i >= 0; i--) {
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
        const [agg] = await Transaction.aggregate([
            { $match: { date: { $lt: end } } },
            { $group: { _id: null, total: { $sum: '$amountCents' } } }
        ]);
        const monthLabel = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
        points.push({ month: monthLabel, netWorthCents: startingTotal + (agg ? agg.total : 0) });
    }
    return points;
}

module.exports = netWorth;
