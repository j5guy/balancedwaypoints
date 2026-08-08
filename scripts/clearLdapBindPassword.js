// One-time repair for LDAP settings copied from another environment's
// database: the bind password is AES-256-GCM encrypted keyed off
// process.env.sessionSecret (see utils/secretCrypto.js). If the Settings
// singleton was copied from a DB that used a different sessionSecret, the
// stored ciphertext can never decrypt under this environment's key —
// getLdapSettings() throws "Unsupported state or unable to authenticate
// data" (GCM auth tag mismatch) on every call, which crashes the LDAP
// admin page before it can even render for the admin to fix it.
//
// This clears only the undecryptable bind password fields, leaving url/
// bindDN/searchBase/searchFilter/enabled untouched, so the admin page loads
// again. The admin must then re-enter the bind password once from the UI —
// setLdapSettings() re-encrypts it under this environment's own
// sessionSecret at that point.
//
// Usage:
//   node scripts/clearLdapBindPassword.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const buildMongoUri = require('../config/mongoUri');
const Settings = require('../models/settings');

async function run() {
    await mongoose.connect(buildMongoUri());

    const doc = await Settings.findById('singleton');
    if (!doc || !doc.ldap || (!doc.ldap.bindPassIv && !doc.ldap.bindPassCiphertext)) {
        console.log('No stored LDAP bind password found — nothing to do.');
    } else {
        doc.ldap.bindPassIv = null;
        doc.ldap.bindPassCiphertext = null;
        await doc.save();
        console.log('Cleared stored LDAP bind password. Re-enter it from the LDAP admin page.');
    }

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
