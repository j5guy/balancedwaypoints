const User = require('../../models/user');

const count = () => User.countDocuments().exec();
const findByEmail = (email) => User.findOne({ email: email.toLowerCase().trim() }).exec();
const findByEmailWithPassword = (email) => User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash').exec();
const findById = (id) => User.findById(id).exec();
const findByLdapUsername = (username) => User.findOne({ authSource: 'ldap', ldapUsername: username }).exec();
const findByOidcSubject = (subject) => User.findOne({ authSource: 'oidc', oidcSubject: subject }).exec();
const list = () => User.find().sort({ email: 1 }).exec();
const create = (data) => User.create(data);
const update = (id, data) => User.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();
const remove = (id) => User.findByIdAndDelete(id).exec();

// See models/user.js's apiKey field / middleware/auth.js's requireApiKeyOrAuth.
const findByApiKeyHash = (hash) => User.findOne({ 'apiKey.hash': hash }).exec();
const setApiKey = (id, { hash, prefix }) => User.findByIdAndUpdate(id, {
    apiKey: { hash, prefix, createdAt: new Date(), lastUsedAt: null }
}, { new: true, runValidators: true }).exec();
const clearApiKey = (id) => User.findByIdAndUpdate(id, {
    apiKey: { hash: null, prefix: null, createdAt: null, lastUsedAt: null }
}, { new: true, runValidators: true }).exec();
// Fire-and-forget from the caller (a request shouldn't wait on this) — swallow
// errors here so an unawaited rejection can't surface as an unhandled one.
const touchApiKeyLastUsed = (id) => User.updateOne({ _id: id }, { $set: { 'apiKey.lastUsedAt': new Date() } }).exec().catch(() => {});

module.exports = {
    count, findByEmail, findByEmailWithPassword, findById, findByLdapUsername, findByOidcSubject,
    list, create, update, remove,
    findByApiKeyHash, setApiKey, clearApiKey, touchApiKeyLastUsed
};
