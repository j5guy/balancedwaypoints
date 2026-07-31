const Account = require('../../models/account');
const Transaction = require('../../models/transaction');

const list = () => Account.find().sort({ name: 1 }).exec();
const findById = (id) => Account.findById(id).exec();
const create = (data) => Account.create(data);
const update = (id, data) => Account.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();

const remove = async (id) => {
    const inUse = await Transaction.exists({ $or: [{ account: id }, { transferAccount: id }] });
    if (inUse) return null;
    return Account.findByIdAndDelete(id).exec();
};

// Current balance = starting balance + signed sum of every transaction
// posted against this account.
const balanceFor = async (accountId) => {
    const account = await Account.findById(accountId).exec();
    if (!account) return null;
    const [agg] = await Transaction.aggregate([
        { $match: { account: account._id } },
        { $group: { _id: null, total: { $sum: '$amountCents' } } }
    ]);
    return account.startingBalanceCents + (agg ? agg.total : 0);
};

const balancesForAll = async () => {
    const accounts = await list();
    const totals = await Transaction.aggregate([
        { $group: { _id: '$account', total: { $sum: '$amountCents' } } }
    ]);
    const totalsByAccount = new Map(totals.map(t => [String(t._id), t.total]));
    return accounts.map(a => ({
        account: a,
        balanceCents: a.startingBalanceCents + (totalsByAccount.get(String(a._id)) || 0)
    }));
};

module.exports = { list, findById, create, update, remove, balanceFor, balancesForAll };
