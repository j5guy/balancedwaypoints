const mongoose = require('mongoose');

const payeeSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    // Set when this payee represents "Transfer to <Account>" — picking it on
    // a transaction creates the paired transfer instead of a normal entry.
    transferAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    // Used to prefill/suggest a category for new transactions against this payee.
    defaultCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    // Free-form contact info — useful for payees you might need to actually
    // contact (a landlord, a utility company), not used anywhere else in the
    // app's logic.
    address: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    // Your own account number with this payee (e.g. a utility or loan
    // account) — plaintext, same trust level as the other contact fields.
    accountNumber: { type: String, trim: true, default: '' }
}, { timestamps: true });

payeeSchema.index({ owner: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Payee', payeeSchema);
