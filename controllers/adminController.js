const usersDb = require('../services/database/users');
const settingsDb = require('../services/database/settings');
const { resolveLdapConfig, testBind } = require('../config/ldapAuth');

function serializeUser(user) {
    return {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt
    };
}

async function listUsers(req, res) {
    const users = await usersDb.list();
    res.json({ users: users.map(serializeUser) });
}

async function setAdmin(req, res) {
    const isAdmin = !!(req.body || {}).isAdmin;
    if (String(req.params.id) === String(req.session.userId) && !isAdmin) {
        return res.status(400).json({ error: "You can't remove your own admin access" });
    }
    const user = await usersDb.update(req.params.id, { isAdmin });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(serializeUser(user));
}

async function removeUser(req, res) {
    if (String(req.params.id) === String(req.session.userId)) {
        return res.status(400).json({ error: "You can't delete your own account" });
    }
    const user = await usersDb.remove(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
}

// ── LDAP settings (Admin > LDAP) — see models/settings.js/config/ldapAuth.js ──
function parseLdapInput(body) {
    const enabled = !!(body || {}).enabled;
    const url = String((body || {}).url || '').trim();
    const bindDN = String((body || {}).bindDN || '').trim();
    const bindPassword = typeof (body || {}).bindPassword === 'string' ? (body || {}).bindPassword : '';
    const searchBase = String((body || {}).searchBase || '').trim();
    const searchFilter = String((body || {}).searchFilter || '').trim();

    if (enabled) {
        if (!url) return { error: 'url is required' };
        if (!bindDN) return { error: 'bindDN is required' };
        if (!searchBase) return { error: 'searchBase is required' };
        if (!searchFilter) return { error: 'searchFilter is required' };
        if (!searchFilter.includes('{{username}}')) return { error: 'searchFilter must contain the {{username}} placeholder' };
    }

    return { enabled, url, bindDN, bindPassword, searchBase, searchFilter };
}

// Never echoes the stored bind password back — only whether one exists.
function serializeLdap(cfg) {
    if (!cfg) return { configured: false, enabled: false, url: null, bindDN: null, searchBase: null, searchFilter: null, hasBindPassword: false };
    return {
        configured: true,
        enabled: cfg.enabled,
        url: cfg.url,
        bindDN: cfg.bindDN,
        searchBase: cfg.searchBase,
        searchFilter: cfg.searchFilter,
        hasBindPassword: !!cfg.bindPassword
    };
}

async function getLdapSettings(req, res) {
    const cfg = await resolveLdapConfig();
    res.json(serializeLdap(cfg));
}

async function updateLdapSettings(req, res) {
    const parsed = parseLdapInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    // A bind password is required the first time enabling LDAP (nothing to
    // fall back to); afterwards an admin can omit it to keep the one
    // already stored, same as the SMTP settings pattern this mirrors.
    const existing = await settingsDb.getLdapSettings();
    if (parsed.enabled && !parsed.bindPassword && !(existing && existing.bindPassword)) {
        return res.status(400).json({ error: 'bindPassword is required' });
    }

    await settingsDb.setLdapSettings(parsed, req.session.userId);
    const cfg = await resolveLdapConfig();
    res.json(serializeLdap(cfg));
}

async function resetLdapSettings(req, res) {
    await settingsDb.clearLdapSettings();
    const cfg = await resolveLdapConfig();
    res.json(serializeLdap(cfg));
}

// Tests either the not-yet-saved values in the request body, or (if the
// body is empty) whatever config is currently active — checks the service
// account bind only (host reachable + credentials valid), not a specific
// user's login.
async function testLdapSettings(req, res) {
    const hasBody = req.body && Object.keys(req.body).length > 0;
    let cfg;

    if (hasBody) {
        const parsed = parseLdapInput(req.body);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        if (!parsed.bindPassword) {
            const existing = await settingsDb.getLdapSettings();
            if (!existing || !existing.bindPassword) return res.status(400).json({ error: 'bindPassword is required' });
            parsed.bindPassword = existing.bindPassword;
        }
        cfg = parsed;
    } else {
        cfg = await resolveLdapConfig();
        if (!cfg) return res.status(400).json({ error: 'LDAP is not configured' });
    }

    const result = await testBind(cfg);
    res.json(result);
}

module.exports = {
    listUsers, setAdmin, removeUser,
    getLdapSettings, updateLdapSettings, resetLdapSettings, testLdapSettings
};
