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
    notes: { type: String, trim: true, default: '' },
    // Per-schedule opt-in — when true, everyone with their own SMTP
    // configured (see models/user.js's smtp field) gets emailed once this
    // occurrence enters its reminder window (see
    // services/jobs/scheduleReminderEmailJob.js).
    notifyByEmail: { type: Boolean, default: false },
    // Dedup marker: the nextDate value a reminder was last sent for, so the
    // same occurrence doesn't re-email every day it sits inside the
    // reminder window. Compared against nextDate, which only changes when a
    // schedule actually advances (auto-enter, or a manual edit).
    lastNotifiedForDate: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Schedule', scheduleSchema);
module.exports.FREQUENCY_UNITS = FREQUENCY_UNITS;
