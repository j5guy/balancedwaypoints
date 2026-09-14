const path = require('path');
const fs = require('fs');
const usersDb = require('../services/database/users');
const settingsDb = require('../services/database/settings');
const backupRunsDb = require('../services/database/backupRuns');
const backupService = require('../services/backup/backupService');
const backupScheduler = require('../services/backup/backupScheduler');
const { resolveLdapConfig, testBind } = require('../config/ldapAuth');
const logExportSettingsStore = require('../services/settings/store');
const tlsCerts = require('../services/settings/tlsCerts');
const exportTransports = require('../services/logging/exportTransports');
const pushgatewayService = require('../services/metrics/pushgateway');
const { webFQDN, webPort } = require('../config/config');
const logger = require('../utils/logger');

// Lazily required (not at module load) to dodge a require cycle — server.js
// self-executes and starts listening as soon as it's required, and it's the
// one requiring routes/admin.js -> this controller in the first place.
const getServer = () => require('../server');

const LOGGING_DESTINATIONS = ['none', 'syslog', 'http'];
const SYSLOG_PROTOCOLS = ['udp4', 'tcp4', 'tls4'];

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

// ── Log export & metrics (Admin > Log Export & Metrics) — see
// services/settings/store.js/services/logging/exportTransports.js/
// services/metrics/pushgateway.js. Unlike LDAP/backup settings above,
// this one small JSON-file-backed store is dedicated to just these two
// features (see services/settings/store.js for why), not settingsDb/Mongo.
function getLoggingSettings(req, res) {
    res.json(logExportSettingsStore.get().logging);
}

function updateLoggingSettings(req, res) {
    const destination = (req.body || {}).destination;
    if (!LOGGING_DESTINATIONS.includes(destination)) {
        return res.status(400).json({ error: 'Invalid logging destination' });
    }

    const patch = { logging: { destination } };
    if (destination === 'syslog') {
        const protocol = (req.body || {}).syslogProtocol;
        if (!SYSLOG_PROTOCOLS.includes(protocol)) {
            return res.status(400).json({ error: 'Invalid syslog protocol' });
        }
        patch.logging.syslog = {
            host: String((req.body || {}).syslogHost || '').trim() || null,
            port: parseInt((req.body || {}).syslogPort, 10) || 514,
            protocol
        };
    } else if (destination === 'http') {
        patch.logging.http = {
            url: String((req.body || {}).httpUrl || '').trim() || null,
            authHeader: String((req.body || {}).httpAuthHeader || '').trim() || null
        };
    }

    const next = logExportSettingsStore.save(patch);
    exportTransports.configure(next);
    res.json(next.logging);
}

function getMetricsSettings(req, res) {
    res.json(logExportSettingsStore.get().metrics);
}

function updateMetricsSettings(req, res) {
    const enabled = !!(req.body || {}).enabled;
    const token = String((req.body || {}).token || '').trim() || null;
    const next = logExportSettingsStore.save({ metrics: { enabled, token } });
    res.json(next.metrics);
}

function updatePushgatewaySettings(req, res) {
    const enabled = !!(req.body || {}).enabled;
    const url = String((req.body || {}).url || '').trim() || null;
    const intervalSeconds = parseInt((req.body || {}).intervalSeconds, 10) || 60;
    const next = logExportSettingsStore.save({ metrics: { pushgateway: { enabled, url, intervalSeconds } } });
    pushgatewayService.start(next);
    res.json(next.metrics);
}

// ── TLS (Admin > Settings) — self-terminated HTTPS, entirely optional. See
// services/settings/tlsCerts.js for the cert/key storage and server.js's
// startServer/restartServer for how a toggle here takes effect without a
// container restart.
const switchProtocolPage = ({ enabled, newUrl }) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="refresh" content="4;url=${newUrl}">
<title>Switching protocol — Balanced Waypoints</title></head>
<body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;line-height:1.5;">
<h1>TLS ${enabled ? 'enabled' : 'disabled'}</h1>
<p>This server is restarting on <code>${newUrl}</code>. Your browser can't be redirected across schemes on this same connection, so you'll be sent there automatically in a few seconds.</p>
<p><a href="${newUrl}">Continue now</a></p>
</body></html>`;

function finishProtocolSwitch(req, res, enabled) {
    const newUrl = `${enabled ? 'https' : 'http'}://${webFQDN}:${webPort}/admin/settings`;
    res.send(switchProtocolPage({ enabled, newUrl }));
    res.on('finish', () => {
        getServer().restartServer().catch((err) => logger.error('Failed to restart server after TLS change: ' + err.message));
    });
}

function enableTls(req, res) {
    try {
        const files = req.files || {};
        const certFile = files.cert && files.cert[0];
        const keyFile = files.key && files.key[0];
        if (!certFile || !keyFile) {
            return res.redirect('/admin/settings?error=' + encodeURIComponent('Both a certificate and a private key file are required.'));
        }

        tlsCerts.validate(certFile.buffer, keyFile.buffer);
        tlsCerts.save(certFile.buffer, keyFile.buffer);
        logExportSettingsStore.save({ tls: { enabled: true } });
        logger.info(`TLS enabled by ${req.session.email}`);
        finishProtocolSwitch(req, res, true);
    } catch (err) {
        logger.error('admin/enableTls error: ' + err.message);
        res.redirect('/admin/settings?error=' + encodeURIComponent(err.message));
    }
}

function disableTls(req, res) {
    try {
        logExportSettingsStore.save({ tls: { enabled: false } });
        logger.info(`TLS disabled by ${req.session.email}`);
        finishProtocolSwitch(req, res, false);
    } catch (err) {
        logger.error('admin/disableTls error: ' + err.message);
        res.redirect('/admin/settings?error=' + encodeURIComponent('Failed to disable TLS.'));
    }
}

module.exports = {
    listUsers, updateUser, setAdmin, removeUser,
    getLdapSettings, updateLdapSettings, resetLdapSettings, testLdapSettings,
    getBackupSettings, updateBackupSettings, checkBackupDestination,
    runBackupNow, listBackupRuns, listBackupFiles, downloadBackupFile, deleteBackupFile,
    restoreFromUpload, restoreFromFile,
    getLoggingSettings, updateLoggingSettings,
    getMetricsSettings, updateMetricsSettings, updatePushgatewaySettings,
    enableTls, disableTls
};
