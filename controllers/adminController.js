const path = require('path');
const fs = require('fs');
const usersDb = require('../services/database/users');
const settingsDb = require('../services/database/settings');
const backupRunsDb = require('../services/database/backupRuns');
const backupService = require('../services/backup/backupService');
const backupScheduler = require('../services/backup/backupScheduler');
const { resolveLdapConfig, testBind } = require('../config/ldapAuth');
const { resolveOidcConfig } = require('../config/oidcAuth');

function serializeUser(user) {
    return {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        authSource: user.authSource,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt
    };
}

async function listUsers(req, res) {
    const users = await usersDb.list();
    res.json({ users: users.map(serializeUser) });
}

// Only email/displayName — the two profile fields also user-editable by
// LDAP self-heal (see authController.js's loginLdap) — not password,
// authSource, or ldapUsername, which stay out of admin's reach here.
async function updateUser(req, res) {
    const email = String((req.body || {}).email || '').toLowerCase().trim();
    const displayName = String((req.body || {}).displayName || '').trim();
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    const conflict = await usersDb.findByEmail(email);
    if (conflict && String(conflict._id) !== String(req.params.id)) {
        return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const user = await usersDb.update(req.params.id, { email, displayName });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(serializeUser(user));
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
    // Their personal backup files on disk are left alone — deleting the
    // account shouldn't silently destroy data an admin might still want.
    backupScheduler.stopUser(req.params.id);
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

// ── OIDC settings (Admin > OIDC) — see models/settings.js/config/oidcAuth.js ──
function parseOidcInput(body) {
    const enabled = !!(body || {}).enabled;
    const issuerUrl = String((body || {}).issuerUrl || '').trim();
    const clientId = String((body || {}).clientId || '').trim();
    const clientSecret = typeof (body || {}).clientSecret === 'string' ? (body || {}).clientSecret : '';
    const scopes = String((body || {}).scopes || '').trim() || 'openid profile email';

    if (enabled) {
        if (!issuerUrl) return { error: 'issuerUrl is required' };
        if (!clientId) return { error: 'clientId is required' };
    }

    return { enabled, issuerUrl, clientId, clientSecret, scopes };
}

// Never echoes the stored client secret back — only whether one exists.
function serializeOidc(cfg) {
    if (!cfg) return { configured: false, enabled: false, issuerUrl: null, clientId: null, scopes: 'openid profile email', hasClientSecret: false };
    return {
        configured: true,
        enabled: cfg.enabled,
        issuerUrl: cfg.issuerUrl,
        clientId: cfg.clientId,
        scopes: cfg.scopes,
        hasClientSecret: !!cfg.clientSecret
    };
}

async function getOidcSettings(req, res) {
    const cfg = await resolveOidcConfig();
    res.json(serializeOidc(cfg));
}

async function updateOidcSettings(req, res) {
    const parsed = parseOidcInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    // A client secret is required the first time enabling OIDC (nothing to
    // fall back to); afterwards an admin can omit it to keep the one
    // already stored, same as updateLdapSettings' bindPassword handling.
    const existing = await settingsDb.getOidcSettings();
    if (parsed.enabled && !parsed.clientSecret && !(existing && existing.clientSecret)) {
        return res.status(400).json({ error: 'clientSecret is required' });
    }

    await settingsDb.setOidcSettings(parsed, req.session.userId);
    const cfg = await resolveOidcConfig();
    res.json(serializeOidc(cfg));
}

async function resetOidcSettings(req, res) {
    await settingsDb.clearOidcSettings();
    const cfg = await resolveOidcConfig();
    res.json(serializeOidc(cfg));
}

// ── Backups (Admin > Backups, site-wide) — see services/backup/backupService.js ──
// My Account > Backups is the personal-scope equivalent of everything below
// — see controllers/accountController.js, which mirrors this against
// ctx: { scope: 'user', userId: req.session.userId } instead.
const SITE_CTX = { scope: 'site' };

async function getBackupSettings(req, res) {
    const settings = await settingsDb.getBackupSettings();
    res.json({ ...settings, defaultDestination: backupService.DEFAULT_DIR });
}

async function updateBackupSettings(req, res) {
    const parsed = backupService.parseBackupSettingsInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const settings = await settingsDb.setBackupSettings(parsed, req.session.userId);
    await backupScheduler.reloadSite();
    res.json({ ...settings, defaultDestination: backupService.DEFAULT_DIR });
}

// Tests either the not-yet-saved destination in the request body, or (if
// omitted) whichever destination is currently configured — same
// test-before-save pattern as testLdapSettings above.
async function checkBackupDestination(req, res) {
    const explicit = req.body && typeof req.body.destination === 'string' ? req.body.destination.trim() : '';
    const destination = explicit || await backupService.resolveDestination(SITE_CTX);
    const result = await backupService.checkDestination(destination);
    res.json({ destination, ...result });
}

async function runBackupNow(req, res) {
    const result = await backupService.runBackup(SITE_CTX, { trigger: 'manual', triggeredBy: req.session.userId });
    if (result.status === 'error') return res.status(422).json({ error: result.error });
    res.json(result);
}

async function listBackupRuns(req, res) {
    const runs = await backupRunsDb.listSite();
    res.json({ runs });
}

async function listBackupFiles(req, res) {
    const result = await backupService.listBackupFiles(SITE_CTX);
    res.json(result);
}

async function downloadBackupFile(req, res) {
    const { name } = req.params;
    if (!backupService.patternForScope(SITE_CTX).test(name)) return res.status(400).json({ error: 'Invalid backup filename' });

    const destination = await backupService.resolveDestination(SITE_CTX);
    const filePath = path.join(destination, name);
    fs.access(filePath, fs.constants.R_OK, (err) => {
        if (err) return res.status(404).json({ error: 'Backup file not found' });
        res.download(filePath, name);
    });
}

async function deleteBackupFile(req, res) {
    const { name } = req.params;
    try {
        await backupService.deleteBackupFile(SITE_CTX, name);
        res.status(204).end();
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}

// Restoring is destructive (wipes and replaces every backed-up collection —
// see backupService.restoreDump) — the confirmation lives client-side
// (public/js/backupPanel.js), same convention as every other dangerous
// action in this app (e.g. deleting a user).
async function restoreFromUpload(req, res) {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await backupService.restoreFromBuffer(SITE_CTX, req.file.buffer, { trigger: 'manual', triggeredBy: req.session.userId });
    if (result.status === 'error') return res.status(422).json({ error: result.error });
    res.json(result);
}

async function restoreFromFile(req, res) {
    const { name } = req.params;
    try {
        const result = await backupService.restoreFromFile(SITE_CTX, name, { trigger: 'manual', triggeredBy: req.session.userId });
        if (result.status === 'error') return res.status(422).json({ error: result.error });
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}

module.exports = {
    listUsers, updateUser, setAdmin, removeUser,
    getLdapSettings, updateLdapSettings, resetLdapSettings, testLdapSettings,
    getOidcSettings, updateOidcSettings, resetOidcSettings,
    getBackupSettings, updateBackupSettings, checkBackupDestination,
    runBackupNow, listBackupRuns, listBackupFiles, downloadBackupFile, deleteBackupFile,
    restoreFromUpload, restoreFromFile
};
