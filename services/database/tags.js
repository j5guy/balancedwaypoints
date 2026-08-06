const Tag = require('../../models/tag');
const Transaction = require('../../models/transaction');

const list = (ownerId) => Tag.find({ owner: ownerId }).sort({ name: 1 }).exec();
const create = (data) => Tag.create(data);
const update = (id, data, ownerId) => Tag.findOneAndUpdate({ _id: id, owner: ownerId }, data, { new: true, runValidators: true }).exec();

const remove = async (id, ownerId) => {
    const deleted = await Tag.findOneAndDelete({ _id: id, owner: ownerId }).exec();
    if (deleted) {
        await Transaction.updateMany({ owner: ownerId, tags: id }, { $pull: { tags: id } }).exec();
    }
    return deleted;
};

const findOrCreateByName = async (name, ownerId) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = await Tag.findOne({ owner: ownerId, name: trimmed }).exec();
    if (existing) return existing;
    try {
        return await Tag.create({ owner: ownerId, name: trimmed });
    } catch (err) {
        if (err.code === 11000) return Tag.findOne({ owner: ownerId, name: trimmed }).exec();
        throw err;
    }
};

module.exports = { list, create, update, remove, findOrCreateByName };
