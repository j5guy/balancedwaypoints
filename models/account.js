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
    sortOrder: { type: Number, default: 0 },
    // Purely organizational grouping for the Accounts page's collapsible
    // sections (see models/accountGroup.js, public/js/accounts.js) — null
    // is a fully-supported "ungrouped" state, never fed into balance math or
    // envelope budgeting.
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountGroup', default: null },
    // Optional bank sync link (see models/simplefinConnection.js and
    // services/simplefin/) — both null for a normal manually-managed
    // account, the default and by far the common case. When set, the
    // scheduled/manual sync job auto-imports new transactions from this
    // specific remote account under that connection, the same way a CSV/OFX
    // import would (same dedupe key convention, same rules engine).
    simplefinConnection: { type: mongoose.Schema.Types.ObjectId, ref: 'SimplefinConnection', default: null },
    simplefinAccountId: { type: String, default: null },
    // The bank-reported balance/date as of the last sync — purely a
    // reconciliation display (see accounts/show.ejs), never fed into the
    // envelope math, which always derives balance from startingBalanceCents
    // + transactions (services/database/accounts.js's balanceForAccountDoc).
    simplefinBalanceCents: { type: Number, default: null },
    simplefinBalanceDate: { type: Date, default: null }
}, { timestamps: true });

accountSchema.index({ owner: 1 });
accountSchema.index({ simplefinConnection: 1 }, { sparse: true });
accountSchema.index({ owner: 1, group: 1 });

module.exports = mongoose.model('Account', accountSchema);
module.exports.ACCOUNT_TYPES = ACCOUNT_TYPES;
