const mongoose = require('mongoose');

// Singleton document (services/database/settings.js always reads/writes the
// fixed _id below) holding household-wide server config that admins can
// change from the UI without a redeploy — currently LDAP and backups. .env
// remains the bootstrap/fallback path for a first run before any admin has
// visited the settings page (see config/ldapAuth.js). Unlike LDAP, SMTP here
// is deliberately per-user (see models/user.js) rather than shared — each
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
    ldapUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // See services/backup/backupService.js/backupScheduler.js. `destination`
    // is a path inside the app container — defaults to ./backups (baked into
    // the image, backed by the bundled `backups-data` volume) when null.
    // Pointing it at a network/NAS location means bind-mounting that host
    // path into the container first (same pattern as SSL_CERT_FILE/
    // mongoHost) and setting destination to the container-side path.
    backup: {
        destination: { type: String, trim: true, default: null },
        frequency: { type: String, enum: ['disabled', 'daily', 'weekly'], default: 'disabled' },
        // HH:MM, 24h, server-local time (America/New_York — see server.js).
        time: { type: String, trim: true, default: '03:00' },
        dayOfWeek: { type: Number, min: 0, max: 6, default: 0 },
        retentionCount: { type: Number, min: 1, default: 7 }
    },
    backupUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
