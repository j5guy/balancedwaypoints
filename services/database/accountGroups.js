const AccountGroup = require('../../models/accountGroup');
const Account = require('../../models/account');

const list = (ownerId) => AccountGroup.find({ owner: ownerId }).sort({ sortOrder: 1, name: 1 }).exec();
const findById = (id, ownerId) => AccountGroup.findOne({ _id: id, owner: ownerId }).exec();
const create = (data) => AccountGroup.create(data);
const update = (id, data, ownerId) => AccountGroup.findOneAndUpdate({ _id: id, owner: ownerId }, data, { new: true, runValidators: true }).exec();

// Unlike categoryGroups.remove (which refuses to delete a group still in
// use), deleting an account group just un-groups its accounts instead of
// being blocked — an account without a group is a normal, fully-supported
// state (see models/account.js), so there's no data-loss risk to guard
// against the way there is for a category (which can't exist without one).
const remove = async (id, ownerId) => {
    const group = await AccountGroup.findOne({ _id: id, owner: ownerId }).exec();
    if (!group) return null;
    await Account.updateMany({ owner: ownerId, group: id }, { group: null }).exec();
    await AccountGroup.findOneAndDelete({ _id: id, owner: ownerId }).exec();
    return group;
};

module.exports = { list, findById, create, update, remove };
