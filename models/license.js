const mongoose = require('mongoose');
const crypto = require('crypto');

// Singleton document (like models/settings.js) — this app's local cache of
// its license state. Two things live here that MUST survive a container
// recreate/recompose so the license "follows" the install rather than
// resetting: instanceId (generated once, on first use) and the last
// successfully validated key. Both are ordinary fields in this app's own
// MongoDB, which is already backed by a persistent volume (see
// docker-compose.mongo.yml) — no extra persistence mechanism needed.
const licenseSchema = new mongoose.Schema({
    _id: { type: String, default: 'singleton' },

    // Generated once via services/database/license.js's getOrCreateInstanceId
    // and never changed thereafter — identifies this install to the
    // licensing service across every future validate/trial call.
    instanceId: { type: String, default: () => crypto.randomUUID() },

    key: { type: String, default: null },
    type: { type: String, enum: ['trial', 'lifetime', 'admin', null], default: null },
    status: { type: String, enum: ['active', 'expired', 'revoked', 'unknown', null], default: null },
    email: { type: String, default: null },
    expiresAt: { type: Date, default: null },

    lastValidatedAt: { type: Date, default: null },
    // False when the last check-in call itself failed (network/licensing
    // service down) rather than returned "invalid" — see
    // services/licensing/gate.js's grace-period handling.
    lastValidationReachable: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('License', licenseSchema);
