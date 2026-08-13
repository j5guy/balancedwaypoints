const mongoose = require('mongoose');
const Account = require('../../models/account');
const Transaction = require('../../models/transaction');
const Schedule = require('../../models/schedule');
const Payee = require('../../models/payee');

const list = (ownerId) => Account.find({ owner: ownerId }).sort({ name: 1 }).exec();
// Every account linked to a given SimpleFIN connection — used by
// services/simplefin/syncService.js to know which local accounts to pull
// transactions into for that connection's sync run.
const findLinkedToSimplefin = (connectionId, ownerId) => Account.find({ owner: ownerId, simplefinConnection: connectionId }).exec();
// findOne (not findById) with owner in the filter itself — a request for
// another user's account id resolves to nothing instead of ever loading it.
const findById = (id, ownerId) => Account.findOne({ _id: id, owner: ownerId }).exec();
const create = (data) => Account.create(data);
const update = (id, data, ownerId) => Account.findOneAndUpdate({ _id: id, owner: ownerId }, data, { new: true, runValidators: true }).exec();

const remove = async (id, ownerId) => {
    const inUse = await Transaction.exists({ owner: ownerId, $or: [{ account: id }, { transferAccount: id }] });
    if (inUse) return null;
    return Account.findOneAndDelete({ _id: id, owner: ownerId }).exec();
};

// Only for accounts the user has already closed — a hard reset for "this
// account is done and I never want to see it or its history again", not a
// substitute for the normal remove() above (which refuses to touch an
// account with any transaction history, closed or not).
class ForceDeleteError extends Error {}

const forceRemove = async (id, ownerId) => {
    const account = await Account.findOne({ _id: id, owner: ownerId }).exec();
    if (!account) return null;
    if (!account.closed) throw new ForceDeleteError('Only closed accounts can be force-deleted');

    // Transfers store the same transferId on both sides (see
    // services/database/transactions.js's createTransfer) — deleting just
    // this account's own rows would leave the paired row on the other
    // account referencing a transferAccount that no longer exists. Collect
    // those pair ids first so both sides go together.
    const ownTransactions = await Transaction.find({ owner: ownerId, account: id }, { transferId: 1 }).exec();
    const transferIds = ownTransactions.filter(t => t.transferId).map(t => t.transferId);
    await Transaction.deleteMany({ owner: ownerId, $or: [{ account: id }, { transferId: { $in: transferIds } }] }).exec();

    // A schedule can't exist without its account (required in the schema),
    // so it goes too rather than being left in a broken state.
    await Schedule.deleteMany({ owner: ownerId, account: id }).exec();

    // A payee representing "Transfer to <this account>" is just a shortcut,
    // not owned by the account — clear the dangling reference instead of
    // deleting the payee itself, which may still be used elsewhere.
    await Payee.updateMany({ owner: ownerId, transferAccount: id }, { transferAccount: null }).exec();

    return Account.findOneAndDelete({ _id: id, owner: ownerId }).exec();
};

// Current balance = starting balance + signed sum of every transaction
// posted against this account. Split out from balanceFor() below so a
// caller that's already resolved account access some other way (e.g.
// services/database/accountShares.js's resolveAccountAccess, for a shared
// account a collaborator doesn't own) can compute a balance without also
// re-checking ownership here.
const balanceForAccountDoc = async (account) => {
    const [agg] = await Transaction.aggregate([
        { $match: { owner: account.owner, account: account._id } },
        { $group: { _id: null, total: { $sum: '$amountCents' } } }
    ]);
    return account.startingBalanceCents + (agg ? agg.total : 0);
};

const balanceFor = async (accountId, ownerId) => {
    const account = await Account.findOne({ _id: accountId, owner: ownerId }).exec();
    if (!account) return null;
    return balanceForAccountDoc(account);
};

const balancesForAll = async (ownerId) => {
    const accounts = await list(ownerId);
    // .aggregate() bypasses Mongoose's usual query-side ObjectId casting
    // (unlike .find()/.findOne() above) — req.session.userId round-trips
    // through the session store's JSON serialization as a plain string, so
    // this needs an explicit cast or it silently matches nothing.
    const totals = await Transaction.aggregate([
        { $match: { owner: new mongoose.Types.ObjectId(ownerId) } },
        { $group: { _id: '$account', total: { $sum: '$amountCents' } } }
    ]);
    const totalsByAccount = new Map(totals.map(t => [String(t._id), t.total]));
    return accounts.map(a => ({
        account: a,
        balanceCents: a.startingBalanceCents + (totalsByAccount.get(String(a._id)) || 0)
    }));
};

module.exports = { list, findLinkedToSimplefin, findById, create, update, remove, forceRemove, balanceFor, balanceForAccountDoc, balancesForAll, ForceDeleteError };
