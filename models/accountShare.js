const mongoose = require('mongoose');

const PERMISSIONS = ['readonly', 'readwrite'];

// Grants one other user access to one of the current user's accounts — see
// services/database/accountShares.js's resolveAccountAccess for how this
// gets checked. `owner` is denormalized from account.owner (same reasoning
// as every other owner field added in Phase 1 — avoids a $lookup on every
// access check) rather than derived by populating `account` each time.
const accountShareSchema = new mongoose.Schema({
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sharedWith: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    permission: { type: String, enum: PERMISSIONS, required: true }
}, { timestamps: true });

// One share per (account, person) — re-sharing just updates the existing row.
accountShareSchema.index({ account: 1, sharedWith: 1 }, { unique: true });
// "Accounts shared with me" / "which owners can I act as" lookups
// (services/database/accountShares.js) — both key off sharedWith first.
accountShareSchema.index({ sharedWith: 1 });

module.exports = mongoose.model('AccountShare', accountShareSchema);
module.exports.PERMISSIONS = PERMISSIONS;
