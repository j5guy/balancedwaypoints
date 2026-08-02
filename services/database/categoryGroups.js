const CategoryGroup = require('../../models/categoryGroup');
const Category = require('../../models/category');

const list = () => CategoryGroup.find().sort({ sortOrder: 1, name: 1 }).exec();
const findById = (id) => CategoryGroup.findById(id).exec();
const create = (data) => CategoryGroup.create(data);
const update = (id, data) => CategoryGroup.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive match so an import's "Groceries" lands on an existing
// "groceries" group instead of creating a near-duplicate.
const findOrCreateByName = async (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const nameMatch = new RegExp(`^${escapeRegExp(trimmed)}$`, 'i');
    const existing = await CategoryGroup.findOne({ name: nameMatch }).exec();
    if (existing) return existing;
    try {
        return await CategoryGroup.create({ name: trimmed });
    } catch (err) {
        if (err.code === 11000) return CategoryGroup.findOne({ name: nameMatch }).exec();
        throw err;
    }
};

const remove = async (id) => {
    const inUse = await Category.exists({ group: id });
    if (inUse) return null;
    return CategoryGroup.findByIdAndDelete(id).exec();
};

module.exports = { list, findById, create, update, remove, findOrCreateByName };
