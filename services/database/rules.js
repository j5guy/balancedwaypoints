const Rule = require('../../models/rule');

const list = () => Rule.find().sort({ priority: 1, name: 1 }).exec();
const findActive = () => Rule.find({ active: true }).sort({ priority: 1 }).exec();
const findById = (id) => Rule.findById(id).exec();
const create = (data) => Rule.create(data);
const update = (id, data) => Rule.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();
const remove = (id) => Rule.findByIdAndDelete(id).exec();

module.exports = { list, findActive, findById, create, update, remove };
