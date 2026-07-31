const Tag = require('../../models/tag');
const Transaction = require('../../models/transaction');

const list = () => Tag.find().sort({ name: 1 }).exec();
const create = (data) => Tag.create(data);
const update = (id, data) => Tag.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();

const remove = async (id) => {
    const deleted = await Tag.findByIdAndDelete(id).exec();
    if (deleted) {
        await Transaction.updateMany({ tags: id }, { $pull: { tags: id } }).exec();
    }
    return deleted;
};

const findOrCreateByName = async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = await Tag.findOne({ name: trimmed }).exec();
    if (existing) return existing;
    try {
        return await Tag.create({ name: trimmed });
    } catch (err) {
        if (err.code === 11000) return Tag.findOne({ name: trimmed }).exec();
        throw err;
    }
};

module.exports = { list, create, update, remove, findOrCreateByName };
