const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');

const populateOpts = ['payee', 'category', 'tags', 'splits.category'];

// 'newest'/'oldest' sort strictly by date FIRST — a batch import (or any
// other bulk create) assigns sortOrder by insertion order, not by the date
// on each row, so leading with sortOrder here would scramble a register
// that was imported out of chronological order. sortOrder only comes in as
// the tiebreaker for same-date rows, where it reflects the order they were
// entered/imported in (see models/transaction.js's default and
// controllers/importController.js's commit(), which assigns strictly
// decreasing values matching the CSV's own row order) — same direction in
// both modes (descending = earliest-entered-or-imported-of-that-day shown
// first) so a same-day cluster reads the same way regardless of which end
// of the date range you're sorting from. 'manual' is the drag-and-drop
// override for anyone who wants a fully hand-arranged order instead.
const SORTS = {
    newest: { date: -1, sortOrder: -1, createdAt: -1 },
    oldest: { date: 1, sortOrder: -1, createdAt: -1 },
    manual: { sortOrder: -1, date: -1, createdAt: -1 }
};

const list = ({ account, category, tag, payee, from, to, limit, sort } = {}) => {
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
    let cursor = Transaction.find(query).sort(SORTS[sort] || SORTS.newest).populate(populateOpts);
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

// Bulk-persists a new manual display order from the register's drag-and-drop
// (see public/js/dragReorder.js) — ids top-to-bottom as currently displayed.
// Allowed even for transfer/schedule-created rows, since this only ever
// touches sortOrder (cosmetic), never the financial fields update() guards.
const reorder = async (ids) => {
    const total = ids.length;
    await Promise.all(ids.map((id, i) => Transaction.updateOne({ _id: id }, { sortOrder: total - i }).exec()));
};

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
    createTransfer, removeTransferPair, reorder, sumForAccount, sumForCategoryMonth
};
