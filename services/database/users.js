const User = require('../../models/user');

const count = () => User.countDocuments().exec();
const findByEmail = (email) => User.findOne({ email: email.toLowerCase().trim() }).exec();
const findByEmailWithPassword = (email) => User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash').exec();
const findById = (id) => User.findById(id).exec();
const findByLdapUsername = (username) => User.findOne({ authSource: 'ldap', ldapUsername: username }).exec();
const list = () => User.find().sort({ email: 1 }).exec();
const create = (data) => User.create(data);
const update = (id, data) => User.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();
const remove = (id) => User.findByIdAndDelete(id).exec();

module.exports = {
    count, findByEmail, findByEmailWithPassword, findById, findByLdapUsername,
    list, create, update, remove
};
