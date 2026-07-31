const mongoose = require('mongoose');

const FREQUENCY_UNITS = ['days', 'weeks', 'months', 'years'];

const splitSchema = new mongoose.Schema({
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    amountCents: { type: Number, required: true },
    notes: { type: String, trim: true, default: '' }
}, { _id: false });

const scheduleSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    payee: { type: mongoose.Schema.Types.ObjectId, ref: 'Payee', default: null },
    amountCents: { type: Number, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    splits: { type: [splitSchema], default: [] },
    frequency: {
        unit: { type: String, enum: FREQUENCY_UNITS, default: 'months' },
        interval: { type: Number, default: 1, min: 1 }
    },
    nextDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    // Auto-entered schedules post a real Transaction the day they're due
    // (services/schedules/scheduler.js). Non-auto-entered ones only ever
    // surface as an "upcoming" reminder computed on the fly.
    autoEnter: { type: Boolean, default: false },
    reminderDaysBefore: { type: Number, default: 3, min: 0 },
    active: { type: Boolean, default: true },
    notes: { type: String, trim: true, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Schedule', scheduleSchema);
module.exports.FREQUENCY_UNITS = FREQUENCY_UNITS;
