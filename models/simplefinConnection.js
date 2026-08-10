const mongoose = require('mongoose');

// One SimpleFIN Bridge link (https://www.simplefin.org) — a user pastes a
// one-time setup token (see services/simplefin/simplefinClient.js's
// claimAccessUrl), which is exchanged exactly once for a permanent access
// URL of the form https://user:pass@bridge.example/simplefin. That URL is
// itself the bearer credential (HTTP Basic embedded in it), so it's
// encrypted at rest the same way as the LDAP bind password/per-user SMTP
// password (models/settings.js, models/user.js) — see utils/secretCrypto.js.
// A single connection can expose several remote accounts (e.g. a bank login
// with checking + savings under one bridge link); each gets linked
// individually to a models/account.js document via that account's
// simplefinConnection/simplefinAccountId fields.
const simplefinConnectionSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // A short user-facing label, e.g. "Chase" — defaults to something
    // generic at creation time since SimpleFIN doesn't hand back an
    // institution name until the first /accounts fetch.
    label: { type: String, trim: true, default: 'Bank connection' },
    accessUrlIv: { type: String, required: true },
    accessUrlCiphertext: { type: String, required: true },
    lastSyncAt: { type: Date, default: null },
    lastSyncStatus: { type: String, enum: ['ok', 'error'], default: null },
    lastSyncError: { type: String, trim: true, default: null }
}, { timestamps: true });

simplefinConnectionSchema.index({ owner: 1 });

module.exports = mongoose.model('SimplefinConnection', simplefinConnectionSchema);
