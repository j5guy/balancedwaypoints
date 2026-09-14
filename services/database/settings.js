const Settings = require('../../models/settings');
const { encrypt, decrypt } = require('../../utils/secretCrypto');

const SINGLETON_ID = 'singleton';

// Returns null if LDAP has never been configured (distinct from "configured
// but disabled") — callers fall back to .env in that case, see config/ldapAuth.js.
async function getLdapSettings() {
    const doc = await Settings.findById(SINGLETON_ID).lean();
    if (!doc || !doc.ldap || !doc.ldap.url) return null;
    return {
        enabled: !!doc.ldap.enabled,
        url: doc.ldap.url,
        bindDN: doc.ldap.bindDN,
        bindPassword: decrypt({ iv: doc.ldap.bindPassIv, ciphertext: doc.ldap.bindPassCiphertext }),
        searchBase: doc.ldap.searchBase,
        searchFilter: doc.ldap.searchFilter,
        updatedAt: doc.updatedAt
    };
}

// Only touches the stored bind password if `bindPassword` is a non-empty
// string — lets an admin update the URL/search base without re-typing the
// bind password every time, since the UI never sends the existing password
// back to the server.
async function setLdapSettings({ enabled, url, bindDN, bindPassword, searchBase, searchFilter }, actorId) {
    const set = {
        'ldap.enabled': !!enabled,
        'ldap.url': url || null,
        'ldap.bindDN': bindDN || null,
        'ldap.searchBase': searchBase || null,
        'ldap.searchFilter': searchFilter || null,
        ldapUpdatedBy: actorId || null
    };
    if (bindPassword) {
        const { iv, ciphertext } = encrypt(bindPassword);
        set['ldap.bindPassIv'] = iv;
        set['ldap.bindPassCiphertext'] = ciphertext;
    }
    await Settings.findByIdAndUpdate(SINGLETON_ID, { $set: set }, { upsert: true, runValidators: true }).exec();
}

async function clearLdapSettings() {
    await Settings.findByIdAndUpdate(SINGLETON_ID, { $set: { ldap: {} } }, { upsert: true }).exec();
}

// Nothing here is a secret, so unlike LDAP this is always fully populated —
// schema defaults (frequency: 'disabled', etc.) apply even before an admin
// has ever saved anything.
async function getBackupSettings() {
    const doc = await Settings.findById(SINGLETON_ID).lean();
    const backup = (doc && doc.backup) || {};
    return {
        destination: backup.destination || null,
        frequency: backup.frequency || 'disabled',
        time: backup.time || '03:00',
        dayOfWeek: Number.isInteger(backup.dayOfWeek) ? backup.dayOfWeek : 0,
        retentionCount: Number.isInteger(backup.retentionCount) ? backup.retentionCount : 7
    };
}

async function setBackupSettings({ destination, frequency, time, dayOfWeek, retentionCount }, actorId) {
    await Settings.findByIdAndUpdate(SINGLETON_ID, {
        $set: {
            'backup.destination': destination || null,
            'backup.frequency': frequency,
            'backup.time': time,
            'backup.dayOfWeek': dayOfWeek,
            'backup.retentionCount': retentionCount,
            backupUpdatedBy: actorId || null
        }
    }, { upsert: true, runValidators: true }).exec();
    return getBackupSettings();
}

module.exports = {
    getLdapSettings, setLdapSettings, clearLdapSettings,
    getBackupSettings, setBackupSettings
};
