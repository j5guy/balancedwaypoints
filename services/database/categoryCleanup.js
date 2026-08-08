const mongoose = require('mongoose');
const Category = require('../../models/category');
const Transaction = require('../../models/transaction');
const CategoryBudget = require('../../models/categoryBudget');
const Payee = require('../../models/payee');
const Rule = require('../../models/rule');
const User = require('../../models/user');

// One count per category id that has ANY transaction referencing it, ever
// (no date bound, unlike services/reports/spendingByCategory.js) — direct
// `category` plus unwound `splits.category`, same two-aggregate/merge
// pattern that file uses, just $count instead of $sum.
async function usageCounts(ownerId) {
    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
    const [direct, splits] = await Promise.all([
        Transaction.aggregate([
            { $match: { owner: ownerObjectId, category: { $ne: null } } },
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]),
        Transaction.aggregate([
            { $match: { owner: ownerObjectId, 'splits.0': { $exists: true } } },
            { $unwind: '$splits' },
            { $match: { 'splits.category': { $ne: null } } },
            { $group: { _id: '$splits.category', count: { $sum: 1 } } }
        ])
    ]);
    const counts = new Map();
    [...direct, ...splits].forEach((row) => {
        const key = String(row._id);
        counts.set(key, (counts.get(key) || 0) + row.count);
    });
    return counts;
}

// Groups every category (including archived — a common real case is an
// archived category and its unarchived recreation both still existing) by
// trimmed/lowercased name, regardless of group — the schema's own unique
// index is (owner, group, name), so same-named categories in different
// groups are exactly the case this needs to catch that the index doesn't.
async function findDuplicates(ownerId) {
    const [categories, counts] = await Promise.all([
        Category.find({ owner: ownerId }).populate('group').exec(),
        usageCounts(ownerId)
    ]);
    const byName = new Map();
    categories.forEach((c) => {
        const key = c.name.trim().toLowerCase();
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(c);
    });
    return [...byName.values()]
        .filter(group => group.length > 1)
        .map(group => group.map(c => ({
            id: c._id,
            name: c.name,
            group: c.group ? { id: c.group._id, name: c.group.name } : null,
            archived: c.archived,
            usageCount: counts.get(String(c._id)) || 0
        })));
}

async function findUnused(ownerId) {
    const [categories, counts] = await Promise.all([
        Category.find({ owner: ownerId }).populate('group').exec(),
        usageCounts(ownerId)
    ]);
    return categories
        .filter(c => !(counts.get(String(c._id)) > 0))
        .map(c => ({
            id: c._id,
            name: c.name,
            group: c.group ? { id: c.group._id, name: c.group.name } : null,
            archived: c.archived
        }));
}

// Reassigns every reference to `fromId` over to `toId` (Transactions,
// CategoryBudget — summing overlapping months per the merge rule below,
// Payee defaults, Rule setCategory actions, dashboard widget selections),
// then deletes `fromId`. Mirrors services/database/categories.js's
// reassignAndRemove technique for the Transaction updates; not wrapped in a
// Mongo transaction since nothing else in this app uses one either
// (reassignAndRemove doesn't).
async function mergeOne(fromId, toId, ownerId) {
    await Transaction.updateMany({ owner: ownerId, category: fromId }, { category: toId }).exec();
    await Transaction.updateMany(
        { owner: ownerId, 'splits.category': fromId },
        { $set: { 'splits.$[elem].category': toId } },
        { arrayFilters: [{ 'elem.category': fromId }] }
    ).exec();

    const budgetRows = await CategoryBudget.find({ owner: ownerId, category: fromId }).exec();
    for (const row of budgetRows) {
        await CategoryBudget.findOneAndUpdate(
            { owner: ownerId, category: toId, month: row.month },
            { $inc: { assignedCents: row.assignedCents } },
            { upsert: true, runValidators: true }
        ).exec();
    }
    await CategoryBudget.deleteMany({ owner: ownerId, category: fromId }).exec();

    await Payee.updateMany({ owner: ownerId, defaultCategory: fromId }, { defaultCategory: toId }).exec();

    // Rule.actions[].value is a plain String (no schema ref — see
    // models/rule.js), so this matches/writes the id as a string.
    await Rule.updateMany(
        { owner: ownerId, actions: { $elemMatch: { type: 'setCategory', value: String(fromId) } } },
        { $set: { 'actions.$[a].value': String(toId) } },
        { arrayFilters: [{ 'a.type': 'setCategory', 'a.value': String(fromId) }] }
    ).exec();

    await User.updateMany(
        { 'preferences.dashboard.widgets.selectedCategoryIds': fromId },
        { $set: { 'preferences.dashboard.widgets.$[].selectedCategoryIds.$[id]': toId } },
        { arrayFilters: [{ id: fromId }] }
    ).exec();

    await Category.findOneAndDelete({ _id: fromId, owner: ownerId }).exec();
}

async function mergeCategories(fromIds, toId, ownerId) {
    for (const fromId of fromIds) {
        await mergeOne(fromId, toId, ownerId);
    }
}

// Re-verifies each id is still actually unused (never trust the client's
// snapshot — the report could be stale by the time Delete is clicked) before
// scrubbing every other reference and deleting it. Returns which ids were
// deleted vs. skipped (found to be in use after all) so the UI can report
// an accurate result instead of silently pretending everything succeeded.
async function deleteUnused(categoryIds, ownerId) {
    const counts = await usageCounts(ownerId);
    const deleted = [];
    const skipped = [];
    for (const id of categoryIds) {
        if (counts.get(String(id)) > 0) { skipped.push(id); continue; }
        await Payee.updateMany({ owner: ownerId, defaultCategory: id }, { defaultCategory: null }).exec();
        await Rule.updateMany(
            { owner: ownerId, actions: { $elemMatch: { type: 'setCategory', value: String(id) } } },
            { $pull: { actions: { type: 'setCategory', value: String(id) } } }
        ).exec();
        await User.updateMany(
            { 'preferences.dashboard.widgets.selectedCategoryIds': id },
            { $pull: { 'preferences.dashboard.widgets.$[].selectedCategoryIds': id } }
        ).exec();
        await CategoryBudget.deleteMany({ owner: ownerId, category: id }).exec();
        const removed = await Category.findOneAndDelete({ _id: id, owner: ownerId }).exec();
        if (removed) deleted.push(id); else skipped.push(id);
    }
    return { deleted, skipped };
}

module.exports = { usageCounts, findDuplicates, findUnused, mergeCategories, deleteUnused };
