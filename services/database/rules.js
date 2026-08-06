const Rule = require('../../models/rule');

const list = (ownerId) => Rule.find({ owner: ownerId }).sort({ priority: 1, name: 1 }).exec();
const findActive = (ownerId) => Rule.find({ owner: ownerId, active: true }).sort({ priority: 1 }).exec();
const findById = (id, ownerId) => Rule.findOne({ _id: id, owner: ownerId }).exec();
const create = (data) => Rule.create(data);
const update = (id, data, ownerId) => Rule.findOneAndUpdate({ _id: id, owner: ownerId }, data, { new: true, runValidators: true }).exec();
const remove = (id, ownerId) => Rule.findOneAndDelete({ _id: id, owner: ownerId }).exec();

module.exports = { list, findActive, findById, create, update, remove };
