const mongoose = require('mongoose');

const payeeSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Encrypted at rest (AES-256-GCM, see utils/secretCrypto.js) — a payee
    // name is the most identifying free text in the app (who you pay).
    // nameHash is a deterministic HMAC blind index standing in for the
    // plaintext wherever Mongo needs to match/dedupe on it (the unique
    // index below, exact-name lookups) — see services/database/payees.js.
    nameIv: { type: String, default: null },
    nameCiphertext: { type: String, default: null },
    nameHash: { type: String, required: true },
    // Set when this payee represents "Transfer to <Account>" — picking it on
    // a transaction creates the paired transfer instead of a normal entry.
    transferAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    // Used to prefill/suggest a category for new transactions against this payee.
    defaultCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    // Free-form contact info — encrypted at rest alongside the name above.
    // Useful for payees you might need to actually contact (a landlord, a
    // utility company), not used anywhere else in the app's logic.
    addressIv: { type: String, default: null },
    addressCiphertext: { type: String, default: null },
    phoneIv: { type: String, default: null },
    phoneCiphertext: { type: String, default: null },
    // Your own account number with this payee (e.g. a utility or loan
    // account) — encrypted at rest, same trust level as the other contact fields.
    accountNumberIv: { type: String, default: null },
    accountNumberCiphertext: { type: String, default: null }
}, { timestamps: true });

payeeSchema.index({ owner: 1, nameHash: 1 }, { unique: true });

module.exports = mongoose.model('Payee', payeeSchema);
