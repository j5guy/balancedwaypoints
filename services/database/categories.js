const Category = require('../../models/category');
const Transaction = require('../../models/transaction');
const CategoryBudget = require('../../models/categoryBudget');

const list = ({ includeArchived = false } = {}) => {
    const query = includeArchived ? {} : { archived: false };
    return Category.find(query).sort({ sortOrder: 1, name: 1 }).populate('group').exec();
};
const findById = (id) => Category.findById(id).populate('group').exec();
const create = (data) => Category.create(data);
const update = (id, data) => Category.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The uniqueness index is per-group, so the lookup needs a groupId — callers
// (e.g. CSV import) resolve/create the group first via categoryGroups.findOrCreateByName.
const findOrCreateByName = async (name, groupId) => {
    const trimmed = (name || '').trim();
    if (!trimmed || !groupId) return null;
    const nameMatch = new RegExp(`^${escapeRegExp(trimmed)}$`, 'i');
    const existing = await Category.findOne({ group: groupId, name: nameMatch }).exec();
    if (existing) return existing;
    try {
        return await Category.create({ name: trimmed, group: groupId });
    } catch (err) {
        if (err.code === 11000) return Category.findOne({ group: groupId, name: nameMatch }).exec();
        throw err;
    }
};

const remove = async (id) => {
    const inUse = await Transaction.exists({ $or: [{ category: id }, { 'splits.category': id }] });
    if (inUse) return null;
    return Category.findByIdAndDelete(id).exec();
};

// A split's category is required by schema (it exists specifically to
// assign part of an amount to a category) — so a split referencing this
// category can never be moved to "no category", only to a real replacement.
const hasSplitReferences = (id) => Transaction.exists({ 'splits.category': id });

// Moves every transaction off this category (to `toCategoryId`, or to no
// category at all if that's null and nothing blocks it — see
// hasSplitReferences, which the caller is expected to have already checked),
// drops its per-month assigned-amount history (that history is meaningless
// once the category is gone), then deletes it. Mechanical only — the
// controller validates toCategoryId actually exists / the split conflict
// above before calling this, same division of labor as the rest of this app.
const reassignAndRemove = async (id, toCategoryId) => {
    await Transaction.updateMany({ category: id }, { category: toCategoryId || null }).exec();
    if (toCategoryId) {
        await Transaction.updateMany(
            { 'splits.category': id },
            { $set: { 'splits.$[elem].category': toCategoryId } },
            { arrayFilters: [{ 'elem.category': id }] }
        ).exec();
    }
    await CategoryBudget.deleteMany({ category: id }).exec();
    return Category.findByIdAndDelete(id).exec();
};

module.exports = { list, findById, create, update, remove, hasSplitReferences, reassignAndRemove, findOrCreateByName };
