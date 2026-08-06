const CategoryGroup = require('../../models/categoryGroup');
const Category = require('../../models/category');
const logger = require('../../utils/logger');

const list = (ownerId) => CategoryGroup.find({ owner: ownerId }).sort({ sortOrder: 1, name: 1 }).exec();
const findById = (id, ownerId) => CategoryGroup.findOne({ _id: id, owner: ownerId }).exec();
const create = (data) => CategoryGroup.create(data);
const update = (id, data, ownerId) => CategoryGroup.findOneAndUpdate({ _id: id, owner: ownerId }, data, { new: true, runValidators: true }).exec();

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive match so an import's "Groceries" lands on an existing
// "groceries" group instead of creating a near-duplicate.
//
// TEMPORARY step-by-step logging (see controllers/importController.js's
// commit()) — every branch this function can take logs exactly what
// happened, since the outer caller was only ever seeing the FINAL return
// value and that wasn't enough to tell which internal step was actually
// producing a falsy result with no thrown error. Safe to strip once the
// import bug is found.
const findOrCreateByName = async (name, ownerId) => {
    const trimmed = (name || '').trim();
    if (!trimmed) {
        logger.error(`categoryGroups.findOrCreateByName: empty name after trim (raw: ${JSON.stringify(name)}) — returning null`);
        return null;
    }
    const nameMatch = new RegExp(`^${escapeRegExp(trimmed)}$`, 'i');
    const existing = await CategoryGroup.findOne({ owner: ownerId, name: nameMatch }).exec();
    if (existing) {
        logger.error(`categoryGroups.findOrCreateByName("${trimmed}", ${ownerId}): found existing group ${existing._id}`);
        return existing;
    }
    try {
        const created = await CategoryGroup.create({ owner: ownerId, name: trimmed });
        logger.error(`categoryGroups.findOrCreateByName("${trimmed}", ${ownerId}): created ${created ? created._id : '<falsy result: ' + JSON.stringify(created) + '>'}`);
        return created;
    } catch (err) {
        logger.error(`categoryGroups.findOrCreateByName("${trimmed}", ${ownerId}): create() threw — name=${err.name} code=${err.code} message=${err.message}`);
        if (err.code === 11000) {
            const retried = await CategoryGroup.findOne({ owner: ownerId, name: nameMatch }).exec();
            logger.error(`categoryGroups.findOrCreateByName("${trimmed}", ${ownerId}): post-11000 retry found ${retried ? retried._id : 'NOTHING'}`);
            return retried;
        }
        throw err;
    }
};

const remove = async (id, ownerId) => {
    const inUse = await Category.exists({ owner: ownerId, group: id });
    if (inUse) return null;
    return CategoryGroup.findOneAndDelete({ _id: id, owner: ownerId }).exec();
};

module.exports = { list, findById, create, update, remove, findOrCreateByName };
