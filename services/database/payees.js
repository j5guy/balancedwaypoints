const Payee = require('../../models/payee');
const Transaction = require('../../models/transaction');

const list = (ownerId) => Payee.find({ owner: ownerId }).sort({ name: 1 }).populate('transferAccount defaultCategory').exec();
const findById = (id, ownerId) => Payee.findOne({ _id: id, owner: ownerId }).exec();
const findByName = (name, ownerId) => Payee.findOne({ owner: ownerId, name: name.trim() }).exec();
const create = (data) => Payee.create(data);
const update = (id, data, ownerId) => Payee.findOneAndUpdate({ _id: id, owner: ownerId }, data, { new: true, runValidators: true }).exec();

const findOrCreateByName = async (name, ownerId) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = await Payee.findOne({ owner: ownerId, name: trimmed }).exec();
    if (existing) return existing;
    try {
        return await Payee.create({ owner: ownerId, name: trimmed });
    } catch (err) {
        if (err.code === 11000) return Payee.findOne({ owner: ownerId, name: trimmed }).exec();
        throw err;
    }
};

const remove = async (id, ownerId) => {
    const inUse = await Transaction.exists({ owner: ownerId, payee: id });
    if (inUse) return null;
    return Payee.findOneAndDelete({ _id: id, owner: ownerId }).exec();
};

module.exports = { list, findById, findByName, findOrCreateByName, create, update, remove };
