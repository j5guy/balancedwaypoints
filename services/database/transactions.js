const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');

const populateOpts = ['payee', 'category', 'tags', 'splits.category'];

const list = ({ account, category, tag, payee, from, to, limit } = {}) => {
    const query = {};
    if (account) query.account = account;
    if (category) query.$or = [{ category }, { 'splits.category': category }];
    if (tag) query.tags = tag;
    if (payee) query.payee = payee;
    if (from || to) {
        query.date = {};
        if (from) query.date.$gte = new Date(from);
        if (to) query.date.$lte = new Date(to);
    }
    let cursor = Transaction.find(query).sort({ date: -1, createdAt: -1 }).populate(populateOpts);
    if (limit) cursor = cursor.limit(limit);
    return cursor.exec();
};

const findById = (id) => Transaction.findById(id).populate(populateOpts).exec();
const findByImportedIds = (importedIds) => Transaction.find({ importedId: { $in: importedIds } }).exec();

const create = (data) => Transaction.create(data);
const update = (id, data) => Transaction.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate(populateOpts).exec();
const remove = (id) => Transaction.findByIdAndDelete(id).exec();

// Both sides of a transfer share a transferId so editing/deleting one can
// keep the other in sync (see updateTransferPair/removeTransferPair below).
const createTransfer = async ({ fromAccount, toAccount, date, amountCents, notes }) => {
    const transferId = new mongoose.Types.ObjectId();
    const [outgoing, incoming] = await Transaction.create([
        { account: fromAccount, transferAccount: toAccount, date, amountCents: -Math.abs(amountCents), transferId, notes },
        { account: toAccount, transferAccount: fromAccount, date, amountCents: Math.abs(amountCents), transferId, notes }
    ]);
    return { outgoing, incoming };
};

const removeTransferPair = async (transferId) => Transaction.deleteMany({ transferId }).exec();

const sumForAccount = async (accountId) => {
    const [agg] = await Transaction.aggregate([
        { $match: { account: new mongoose.Types.ObjectId(accountId) } },
        { $group: { _id: null, total: { $sum: '$amountCents' } } }
    ]);
    return agg ? agg.total : 0;
};

// Signed total for a category within a given month ('YYYY-MM'), counting
// both direct-category transactions and any splits assigned to it.
const sumForCategoryMonth = async (categoryId, month) => {
    const [year, monthNum] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, monthNum - 1, 1));
    const end = new Date(Date.UTC(year, monthNum, 1));
    const catId = new mongoose.Types.ObjectId(categoryId);

    const [direct] = await Transaction.aggregate([
        { $match: { category: catId, date: { $gte: start, $lt: end } } },
        { $group: { _id: null, total: { $sum: '$amountCents' } } }
    ]);
    const [splitAgg] = await Transaction.aggregate([
        { $match: { 'splits.category': catId, date: { $gte: start, $lt: end } } },
        { $unwind: '$splits' },
        { $match: { 'splits.category': catId } },
        { $group: { _id: null, total: { $sum: '$splits.amountCents' } } }
    ]);
    return (direct ? direct.total : 0) + (splitAgg ? splitAgg.total : 0);
};

module.exports = {
    list, findById, findByImportedIds, create, update, remove,
    createTransfer, removeTransferPair, sumForAccount, sumForCategoryMonth
};
