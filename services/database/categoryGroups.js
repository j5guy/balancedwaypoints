const CategoryGroup = require('../../models/categoryGroup');
const Category = require('../../models/category');

const list = (ownerId) => CategoryGroup.find({ owner: ownerId }).sort({ sortOrder: 1, name: 1 }).exec();
const findById = (id, ownerId) => CategoryGroup.findOne({ _id: id, owner: ownerId }).exec();
const create = (data) => CategoryGroup.create(data);
const update = (id, data, ownerId) => CategoryGroup.findOneAndUpdate({ _id: id, owner: ownerId }, data, { new: true, runValidators: true }).exec();

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive match so an import's "Groceries" lands on an existing
// "groceries" group instead of creating a near-duplicate. The 11000 catch
// here used to be able to mask a stale, pre-multi-tenancy global unique
// index on `name` (no `owner` in it at all) — the create() would fail
// against SOME other owner's same-named group, and the owner-scoped retry
// query would then correctly find nothing, silently returning null with no
// visible error. See scripts/fixCategoryGroupIndex.js, which drops that
// leftover index; once it's been run this catch only ever fires for genuine
// same-owner races.
const findOrCreateByName = async (name, ownerId) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const nameMatch = new RegExp(`^${escapeRegExp(trimmed)}$`, 'i');
    const existing = await CategoryGroup.findOne({ owner: ownerId, name: nameMatch }).exec();
    if (existing) return existing;
    try {
        return await CategoryGroup.create({ owner: ownerId, name: trimmed });
    } catch (err) {
        if (err.code === 11000) return CategoryGroup.findOne({ owner: ownerId, name: nameMatch }).exec();
        throw err;
    }
};

const remove = async (id, ownerId) => {
    const inUse = await Category.exists({ owner: ownerId, group: id });
    if (inUse) return null;
    return CategoryGroup.findOneAndDelete({ _id: id, owner: ownerId }).exec();
};

module.exports = { list, findById, create, update, remove, findOrCreateByName };
