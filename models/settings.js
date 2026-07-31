const mongoose = require('mongoose');

// Singleton document (services/database/settings.js always reads/writes the
// fixed _id below) holding household-wide server config that admins can
// change from the UI without a redeploy — currently just LDAP. .env remains
// the bootstrap/fallback path for a first run before any admin has visited
// the settings page (see config/ldapAuth.js). Unlike LDAP, SMTP here is
// deliberately per-user (see models/user.js) rather than shared — each
// person configures their own outgoing mail server.
const settingsSchema = new mongoose.Schema({
    _id: { type: String, default: 'singleton' },
    ldap: {
        enabled: { type: Boolean, default: false },
        url: { type: String, trim: true, default: null },
        bindDN: { type: String, trim: true, default: null },
        // AES-256-GCM ciphertext — see utils/secretCrypto.js.
        bindPassIv: { type: String, default: null },
        bindPassCiphertext: { type: String, default: null },
        searchBase: { type: String, trim: true, default: null },
        // Must contain the {{username}} placeholder passport-ldapauth
        // replaces with the entered username, e.g. "(sAMAccountName={{username}})".
        searchFilter: { type: String, trim: true, default: null }
    },
    ldapUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
