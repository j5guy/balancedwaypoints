const Category = require('../../models/category');
const Transaction = require('../../models/transaction');

const list = ({ includeArchived = false } = {}) => {
    const query = includeArchived ? {} : { archived: false };
    return Category.find(query).sort({ sortOrder: 1, name: 1 }).populate('group').exec();
};
const findById = (id) => Category.findById(id).populate('group').exec();
const create = (data) => Category.create(data);
const update = (id, data) => Category.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();

const remove = async (id) => {
    const inUse = await Transaction.exists({ $or: [{ category: id }, { 'splits.category': id }] });
    if (inUse) return null;
    return Category.findByIdAndDelete(id).exec();
};

module.exports = { list, findById, create, update, remove };
