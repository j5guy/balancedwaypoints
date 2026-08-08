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
    // one persistent value per account instead of one per widget. This is
    // the "low" tier of the register chart's banded threshold coloring;
    // mid/upper below are optional additional tiers (null = that band is
    // off) — see buildRegisterForecastSvg for how the three combine.
    forecastThresholdCents: { type: Number, default: 0 },
    forecastThresholdColor: { type: String, trim: true, default: '#B5433A' },
    forecastThresholdMidCents: { type: Number, default: null },
    forecastThresholdMidColor: { type: String, trim: true, default: '#E3A93A' },
    forecastThresholdUpperCents: { type: Number, default: null },
    forecastThresholdUpperColor: { type: String, trim: true, default: '#2E8B57' },
    closed: { type: Boolean, default: false },
    notes: { type: String, trim: true, default: '' },
    sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

accountSchema.index({ owner: 1 });

module.exports = mongoose.model('Account', accountSchema);
module.exports.ACCOUNT_TYPES = ACCOUNT_TYPES;
