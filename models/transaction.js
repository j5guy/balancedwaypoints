const mongoose = require('mongoose');

const CLEARED_STATES = ['pending', 'cleared', 'reconciled'];

// A split line reassigns part of the parent transaction's amount to a
// different category. When splits are present, the parent's own `category`
// is null and sum(splits.amountCents) must equal the parent's amountCents.
const splitSchema = new mongoose.Schema({
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    amountCents: { type: Number, required: true },
    notes: { type: String, trim: true, default: '' }
}, { _id: false });

const transactionSchema = new mongoose.Schema({
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    date: { type: Date, required: true },
    payee: { type: mongoose.Schema.Types.ObjectId, ref: 'Payee', default: null },
    // Signed integer cents — negative is an outflow, positive is an inflow.
    amountCents: { type: Number, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    splits: { type: [splitSchema], default: [] },
    cleared: { type: String, enum: CLEARED_STATES, default: 'pending' },
    tags: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tag' }], default: [] },
    notes: { type: String, trim: true, default: '' },
    // Set on both sides of a transfer — transferId links the pair so editing/
    // deleting one side can keep the other in sync.
    transferAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    transferId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Dedup key for CSV/OFX re-import — OFX's FITID directly, or a hash of
    // account+date+amount+payee for CSV (see services/import/dedupe.js).
    importedId: { type: String, default: null },
    // Set when this row was auto-entered by services/schedules/scheduler.js,
    // or manually "posted" from an upcoming occurrence in the register.
    schedule: { type: mongoose.Schema.Types.ObjectId, ref: 'Schedule', default: null },
    // The occurrence date this transaction fulfills, per the schedule's own
    // recurrence — distinct from `date` above, which is when it's actually
    // dated (posting can back/forward-date to today or a custom date). Lets
    // the schedule's upcoming projection know this occurrence is already
    // posted even though it isn't dated on its "natural" schedule date.
    scheduleOccurrenceDate: { type: Date, default: null },
    // Manual display-order override for the register (drag-and-drop) —
    // purely cosmetic, never used for balance math (see
    // services/budget/envelope.js and the register's running-balance
    // calculation, both of which sort by `date` instead). Defaults to the
    // creation timestamp so new transactions land at the top of the
    // register (sorted desc) exactly like before, until manually dragged.
    sortOrder: { type: Number, default: () => Date.now() }
}, { timestamps: true });

transactionSchema.index({ account: 1, date: -1 });
transactionSchema.index({ account: 1, sortOrder: -1 });
transactionSchema.index({ importedId: 1 }, { sparse: true });
transactionSchema.index({ category: 1, date: 1 });
transactionSchema.index({ schedule: 1, scheduleOccurrenceDate: 1 }, { sparse: true });

module.exports = mongoose.model('Transaction', transactionSchema);
module.exports.CLEARED_STATES = CLEARED_STATES;
