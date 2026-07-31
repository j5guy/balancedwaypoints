const Payee = require('../../models/payee');
const Transaction = require('../../models/transaction');

const list = () => Payee.find().sort({ name: 1 }).populate('transferAccount defaultCategory').exec();
const findById = (id) => Payee.findById(id).exec();
const findByName = (name) => Payee.findOne({ name: name.trim() }).exec();
const create = (data) => Payee.create(data);
const update = (id, data) => Payee.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();

const findOrCreateByName = async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = await Payee.findOne({ name: trimmed }).exec();
    if (existing) return existing;
    try {
        return await Payee.create({ name: trimmed });
    } catch (err) {
        if (err.code === 11000) return Payee.findOne({ name: trimmed }).exec();
        throw err;
    }
};

const remove = async (id) => {
    const inUse = await Transaction.exists({ payee: id });
    if (inUse) return null;
    return Payee.findByIdAndDelete(id).exec();
};

module.exports = { list, findById, findByName, findOrCreateByName, create, update, remove };
