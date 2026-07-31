const CategoryGroup = require('../../models/categoryGroup');
const Category = require('../../models/category');

const list = () => CategoryGroup.find().sort({ sortOrder: 1, name: 1 }).exec();
const findById = (id) => CategoryGroup.findById(id).exec();
const create = (data) => CategoryGroup.create(data);
const update = (id, data) => CategoryGroup.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();

const remove = async (id) => {
    const inUse = await Category.exists({ group: id });
    if (inUse) return null;
    return CategoryGroup.findByIdAndDelete(id).exec();
};

module.exports = { list, findById, create, update, remove };
