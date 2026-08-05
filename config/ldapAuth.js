// Direct ldapjs bind/search — not passport-ldapauth — because the LDAP
// server details need to be resolved fresh on every login attempt (an admin
// can change them from the UI without a restart, see services/database/settings.js),
// and driving ldapjs directly here keeps that fully under our control rather
// than depending on a strategy library's less-common dynamic-options path.
const ldap = require('ldapjs');
const settingsDb = require('../services/database/settings');

// Settings saved from Admin > LDAP (services/database/settings.js) take
// priority over .env, so an admin can set up or change LDAP without a
// redeploy; .env remains the bootstrap/fallback path for a fresh install
// (and the only way to configure it during the guided setup wizard) before
// anyone has visited the settings page.
async function resolveLdapConfig() {
    const dbSettings = await settingsDb.getLdapSettings();
    if (dbSettings) return dbSettings;

    if (process.env.LDAP_URL) {
        return {
            enabled: process.env.LDAP_ENABLED === 'true',
            url: process.env.LDAP_URL,
            bindDN: process.env.LDAP_BIND_DN,
            bindPassword: process.env.LDAP_BIND_PASSWORD,
            searchBase: process.env.LDAP_SEARCH_BASE,
            searchFilter: process.env.LDAP_SEARCH_FILTER
        };
    }
    return null;
}

// Escapes characters with special meaning in an LDAP filter (RFC 4515) —
// the entered username is untrusted input spliced directly into the filter
// string below, so this matters the same way SQL-escaping a raw string does.
function escapeLdapFilter(value) {
    return String(value).replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

// Resolves { url, bindDN, bindPassword, searchBase, searchFilter } + a
// username/password pair to the matched directory entry, or throws.
// searchFilter must contain the literal placeholder {{username}}.
function authenticateLdap(config, username, password) {
    return new Promise((resolve, reject) => {
        if (!password) return reject(new Error('Password is required'));

        const adminClient = ldap.createClient({ url: config.url, tlsOptions: { rejectUnauthorized: false } });
        adminClient.on('error', (err) => reject(new Error('LDAP connection error: ' + err.message)));

        adminClient.bind(config.bindDN, config.bindPassword, (bindErr) => {
            if (bindErr) {
                adminClient.unbind(() => {});
                return reject(new Error('LDAP service bind failed: ' + bindErr.message));
            }

            const filter = config.searchFilter.replace('{{username}}', escapeLdapFilter(username));
            const searchOpts = { filter, scope: 'sub', attributes: ['dn', 'mail', 'cn', 'displayName', 'uid', 'sAMAccountName'] };

            adminClient.search(config.searchBase, searchOpts, (searchErr, searchRes) => {
                if (searchErr) {
                    adminClient.unbind(() => {});
                    return reject(new Error('LDAP search failed: ' + searchErr.message));
                }

                let entry = null;
                searchRes.on('searchEntry', (e) => { entry = e.object || e.pojo; });
                searchRes.on('error', (err) => {
                    adminClient.unbind(() => {});
                    reject(new Error('LDAP search error: ' + err.message));
                });
                searchRes.on('end', () => {
                    adminClient.unbind(() => {});
                    if (!entry) return reject(new Error('Invalid username or password'));

                    const userDn = entry.objectName || entry.dn;
                    const userClient = ldap.createClient({ url: config.url, tlsOptions: { rejectUnauthorized: false } });
                    // Without this, a socket/TLS-level error on this second
                    // client (as opposed to one passed into the bind()
                    // callback below) has no listener to catch it — Node
                    // throws synchronously on an unhandled EventEmitter
                    // 'error', outside this Promise's executor, so it can't
                    // be caught by loginLdap's try/catch either.
                    userClient.on('error', (err) => reject(new Error('LDAP connection error: ' + err.message)));
                    userClient.bind(userDn, password, (userBindErr) => {
                        userClient.unbind(() => {});
                        if (userBindErr) return reject(new Error('Invalid username or password'));
                        resolve(entry);
                    });
                });
            });
        });
    });
}

// Verifies just the service-account bind (host reachability + bindDN/
// bindPassword) — used by the admin "Test connection" button, which checks
// the directory is reachable at all, not a specific user's credentials.
function testBind(config) {
    return new Promise((resolve) => {
        const client = ldap.createClient({ url: config.url, tlsOptions: { rejectUnauthorized: false }, connectTimeout: 5000 });
        client.on('error', (err) => resolve({ ok: false, message: err.message }));
        client.bind(config.bindDN, config.bindPassword, (err) => {
            client.unbind(() => {});
            if (err) return resolve({ ok: false, message: err.message });
            resolve({ ok: true });
        });
    });
}

module.exports = { resolveLdapConfig, authenticateLdap, testBind };
