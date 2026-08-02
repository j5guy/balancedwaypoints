const Account = require('../../models/account');
const Transaction = require('../../models/transaction');
const Schedule = require('../../models/schedule');
const Payee = require('../../models/payee');

const list = () => Account.find().sort({ name: 1 }).exec();
const findById = (id) => Account.findById(id).exec();
const create = (data) => Account.create(data);
const update = (id, data) => Account.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();

const remove = async (id) => {
    const inUse = await Transaction.exists({ $or: [{ account: id }, { transferAccount: id }] });
    if (inUse) return null;
    return Account.findByIdAndDelete(id).exec();
};

// Only for accounts the user has already closed — a hard reset for "this
// account is done and I never want to see it or its history again", not a
// substitute for the normal remove() above (which refuses to touch an
// account with any transaction history, closed or not).
class ForceDeleteError extends Error {}

const forceRemove = async (id) => {
    const account = await Account.findById(id).exec();
    if (!account) return null;
    if (!account.closed) throw new ForceDeleteError('Only closed accounts can be force-deleted');

    // Transfers store the same transferId on both sides (see
    // services/database/transactions.js's createTransfer) — deleting just
    // this account's own rows would leave the paired row on the other
    // account referencing a transferAccount that no longer exists. Collect
    // those pair ids first so both sides go together.
    const ownTransactions = await Transaction.find({ account: id }, { transferId: 1 }).exec();
    const transferIds = ownTransactions.filter(t => t.transferId).map(t => t.transferId);
    await Transaction.deleteMany({ $or: [{ account: id }, { transferId: { $in: transferIds } }] }).exec();

    // A schedule can't exist without its account (required in the schema),
    // so it goes too rather than being left in a broken state.
    await Schedule.deleteMany({ account: id }).exec();

    // A payee representing "Transfer to <this account>" is just a shortcut,
    // not owned by the account — clear the dangling reference instead of
    // deleting the payee itself, which may still be used elsewhere.
    await Payee.updateMany({ transferAccount: id }, { transferAccount: null }).exec();

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

module.exports = { list, findById, create, update, remove, forceRemove, balanceFor, balancesForAll, ForceDeleteError };
