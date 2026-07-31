const Schedule = require('../../models/schedule');

const list = () => Schedule.find().sort({ nextDate: 1 }).populate('account payee category').exec();
const findById = (id) => Schedule.findById(id).populate('account payee category').exec();
const findDue = (asOf = new Date()) => Schedule.find({ active: true, autoEnter: true, nextDate: { $lte: asOf } }).exec();
const create = (data) => Schedule.create(data);
const update = (id, data) => Schedule.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();
const remove = (id) => Schedule.findByIdAndDelete(id).exec();

module.exports = { list, findById, findDue, create, update, remove };
