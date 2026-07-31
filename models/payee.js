const mongoose = require('mongoose');

const payeeSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, unique: true },
    // Set when this payee represents "Transfer to <Account>" — picking it on
    // a transaction creates the paired transfer instead of a normal entry.
    transferAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    // Used to prefill/suggest a category for new transactions against this payee.
    defaultCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null }
}, { timestamps: true });

module.exports = mongoose.model('Payee', payeeSchema);
