const mongoose = require('mongoose');

const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash', 'investment', 'loan', 'other'];

const accountSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ACCOUNT_TYPES, default: 'checking' },
    // Off-budget/tracking accounts (investments, loans) are excluded from
    // envelope math (services/budget/envelope.js) but still show a balance.
    onBudget: { type: Boolean, default: true },
    startingBalanceCents: { type: Number, default: 0 },
    // The register's own Forecast chart flags the first projected day the
    // balance would drop below this (see services/reports/forecast.js's
    // consumer, public/js/register.js's buildRegisterForecastSvg) — same
    // idea as the Dashboard's per-widget-instance forecast threshold, just
    // one persistent value per account instead of one per widget. null =
    // no warning threshold configured (the default) — distinct from an
    // explicit $0. Also skipped entirely for credit/loan/other account
    // types regardless of this value, since a negative balance there is
    // normal (it's debt), not a low-balance warning — see
    // buildRegisterForecastSvg's SUPPRESS_WARNING_TYPES.
    forecastThresholdCents: { type: Number, default: null },
    forecastThresholdColor: { type: String, trim: true, default: '#B5433A' },
    closed: { type: Boolean, default: false },
    notes: { type: String, trim: true, default: '' },
    sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

accountSchema.index({ owner: 1 });

module.exports = mongoose.model('Account', accountSchema);
module.exports.ACCOUNT_TYPES = ACCOUNT_TYPES;
