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

const list = (ownerId, { account, category, tag, payee, from, to, limit, sort } = {}) => {
    const query = { owner: ownerId };
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

const findById = (id, ownerId) => Transaction.findOne({ _id: id, owner: ownerId }).populate(populateOpts).exec();
// No owner filter — for controllers/transactionsController.js's id-scoped
// actions (get/update/remove/reorder), which now need to read a
// transaction's `account` FIRST, then resolve access via
// services/database/accountShares.js's resolveAccountAccess (a collaborator
// isn't the transaction's `owner`, so the owner-scoped findById above can't
// be used until access — and the real owner — is known).
const findByIdRaw = (id) => Transaction.findById(id).populate(populateOpts).exec();
const findByImportedIds = (importedIds, ownerId) => Transaction.find({ owner: ownerId, importedId: { $in: importedIds } }).exec();
// For services/simplefin/syncService.js's first-sync starting-balance
// reconciliation — needs to know whether an account had any activity at all
// before this sync's own imports land, so it can't just check the post-
// import count.
const existsForAccount = (accountId, ownerId) => Transaction.exists({ owner: ownerId, account: accountId });

const create = (data) => Transaction.create(data);
const update = (id, data, ownerId) => Transaction.findOneAndUpdate({ _id: id, owner: ownerId }, data, { new: true, runValidators: true }).populate(populateOpts).exec();
const remove = (id, ownerId) => Transaction.findOneAndDelete({ _id: id, owner: ownerId }).exec();

// Both sides of a transfer share a transferId so editing/deleting one can
// keep the other in sync (see updateTransferPair/removeTransferPair below).
// `schedule`/`scheduleOccurrenceDate` are optional — set on both legs when
// this transfer fulfills a transfer schedule (see
// services/schedules/scheduler.js and controllers/schedulesController.js's
// postOccurrence), same two fields a plain scheduled transaction gets.
// Both legs are marked cleared immediately — a transfer moves money between
// two of your own accounts, so unlike a regular transaction there's no
// external institution whose posting you're waiting to reconcile against.
const createTransfer = async ({ owner, fromAccount, toAccount, date, amountCents, notes, schedule = null, scheduleOccurrenceDate = null }) => {
    const transferId = new mongoose.Types.ObjectId();
    const [outgoing, incoming] = await Transaction.create([
        { owner, account: fromAccount, transferAccount: toAccount, date, amountCents: -Math.abs(amountCents), transferId, notes, schedule, scheduleOccurrenceDate, cleared: 'cleared' },
        { owner, account: toAccount, transferAccount: fromAccount, date, amountCents: Math.abs(amountCents), transferId, notes, schedule, scheduleOccurrenceDate, cleared: 'cleared' }
    ]);
    return { outgoing, incoming };
};

const removeTransferPair = async (transferId, ownerId) => Transaction.deleteMany({ transferId, owner: ownerId }).exec();

// Posts an autopay bill that drafts from a different account than the one
// it's billed against (a schedule with both autopay and autopayFromAccount
// set — see models/schedule.js). Same paired-transaction shape as
// createTransfer above (linked by a shared transferId, opposite-signed,
// draft leg auto-cleared since there's no external institution to
// reconcile it against), except the billed leg keeps its own payee/
// category/splits instead of being a bare transfer, and both legs are
// flagged `autopay: true` for the register's badge. Deleting/removing
// either leg already cascades to the other via the shared transferId (see
// controllers/transactionsController.js's remove(), which doesn't
// distinguish a transfer pair from an autopay pair).
const createAutopayOccurrence = async ({ owner, account, autopayFromAccount, date, amountCents, payee, category, splits, notes, schedule = null, scheduleOccurrenceDate = null }) => {
    const transferId = new mongoose.Types.ObjectId();
    const [draft, bill] = await Transaction.create([
        { owner, account: autopayFromAccount, transferAccount: account, date, amountCents: -Math.abs(amountCents), transferId, notes, schedule, scheduleOccurrenceDate, cleared: 'cleared', autopay: true },
        { owner, account, transferAccount: autopayFromAccount, date, amountCents, payee, category, splits, transferId, notes, schedule, scheduleOccurrenceDate, autopay: true }
    ]);
    return { draft, bill };
};

// Bulk-persists a new manual display order from the register's drag-and-drop
// (see public/js/dragReorder.js) — ids top-to-bottom as currently displayed.
// Allowed even for transfer/schedule-created rows, since this only ever
// touches sortOrder (cosmetic), never the financial fields update() guards.
const reorder = async (ids, ownerId) => {
    const total = ids.length;
    await Promise.all(ids.map((id, i) => Transaction.updateOne({ _id: id, owner: ownerId }, { sortOrder: total - i }).exec()));
};

// .aggregate() bypasses Mongoose's usual query-side ObjectId casting — both
// owner and accountId/categoryId need an explicit cast here (owner because
// req.session.userId round-trips through the session store's JSON
// serialization as a plain string, same reasoning already applied to
// accountId/categoryId below before this file added owner-scoping).
const sumForAccount = async (accountId, ownerId) => {
    const [agg] = await Transaction.aggregate([
        { $match: { owner: new mongoose.Types.ObjectId(ownerId), account: new mongoose.Types.ObjectId(accountId) } },
        { $group: { _id: null, total: { $sum: '$amountCents' } } }
    ]);
    return agg ? agg.total : 0;
};

// Signed total for a category within a given month ('YYYY-MM'), counting
// both direct-category transactions and any splits assigned to it.
const sumForCategoryMonth = async (categoryId, month, ownerId) => {
    const [year, monthNum] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, monthNum - 1, 1));
    const end = new Date(Date.UTC(year, monthNum, 1));
    const catId = new mongoose.Types.ObjectId(categoryId);
    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);

    const [direct] = await Transaction.aggregate([
        { $match: { owner: ownerObjectId, category: catId, date: { $gte: start, $lt: end } } },
        { $group: { _id: null, total: { $sum: '$amountCents' } } }
    ]);
    const [splitAgg] = await Transaction.aggregate([
        { $match: { owner: ownerObjectId, 'splits.category': catId, date: { $gte: start, $lt: end } } },
        { $unwind: '$splits' },
        { $match: { 'splits.category': catId } },
        { $group: { _id: null, total: { $sum: '$splits.amountCents' } } }
    ]);
    return (direct ? direct.total : 0) + (splitAgg ? splitAgg.total : 0);
};

module.exports = {
    list, findById, findByIdRaw, findByImportedIds, existsForAccount, create, update, remove,
    createTransfer, removeTransferPair, createAutopayOccurrence, reorder, sumForAccount, sumForCategoryMonth
};
