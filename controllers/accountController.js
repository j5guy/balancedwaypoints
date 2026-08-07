// Self-service settings for the logged-in user's own account — distinct
// from controllers/adminController.js, which manages *other* users. Only
// ever touches req.session.userId's own document.
const path = require('path');
const fs = require('fs');
const usersDb = require('../services/database/users');
const backupRunsDb = require('../services/database/backupRuns');
const backupService = require('../services/backup/backupService');
const backupScheduler = require('../services/backup/backupScheduler');
const { encrypt } = require('../utils/secretCrypto');
const { generateApiKey } = require('../utils/apiKeyCrypto');
const { resolveUserSmtp, testUserSmtp } = require('../services/mail/userMailer');

const VALID_PORT = (port) => Number.isInteger(port) && port > 0 && port <= 65535;

function parseSmtpInput(body) {
    const host = String((body || {}).host || '').trim();
    const portRaw = (body || {}).port;
    const port = portRaw === '' || portRaw === undefined || portRaw === null ? null : Number(portRaw);
    const secure = (body || {}).secure === undefined || (body || {}).secure === null ? null : !!(body || {}).secure;
    const user = String((body || {}).user || '').trim();
    const from = String((body || {}).from || '').trim();
    const pass = typeof (body || {}).pass === 'string' ? (body || {}).pass : '';

    if (!host) return { error: 'host is required' };
    if (port === null || !VALID_PORT(port)) return { error: 'port must be between 1 and 65535' };
    if (!user) return { error: 'user is required' };

    return { host, port, secure, user, from: from || null, pass };
}

// Never echoes the stored password back — only whether one exists.
function serializeAccount(user) {
    const smtp = user.smtp || {};
    return {
        email: user.email,
        displayName: user.displayName,
        authSource: user.authSource,
        notifyEmail: user.notifyEmail || user.email || null,
        smtp: {
            configured: !!(smtp.host && smtp.user),
            host: smtp.host || null,
            port: smtp.port || null,
            secure: smtp.secure,
            user: smtp.user || null,
            from: smtp.from || null,
            hasPassword: !!(smtp.passIv && smtp.passCiphertext)
        },
        weeklyReportEmail: !!(user.preferences && user.preferences.weeklyReportEmail),
        homeDashboard: (user.preferences && user.preferences.homeDashboard) || 'budget',
        themeColors: user.themeColors,
        apiKey: {
            configured: !!(user.apiKey && user.apiKey.prefix),
            prefix: (user.apiKey && user.apiKey.prefix) || null,
            createdAt: (user.apiKey && user.apiKey.createdAt) || null,
            lastUsedAt: (user.apiKey && user.apiKey.lastUsedAt) || null
        }
    };
}

async function getAccount(req, res) {
    const user = await usersDb.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(serializeAccount(user));
}

async function updateSmtp(req, res) {
    const parsed = parseSmtpInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const user = await usersDb.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });

    // A password is required the very first time (nothing to fall back to);
    // afterwards it can be omitted to keep the one already stored, since the
    // UI never sends the existing password back to the browser.
    if (!parsed.pass && !(user.smtp && user.smtp.passIv)) {
        return res.status(400).json({ error: 'pass is required' });
    }

    user.smtp.host = parsed.host;
    user.smtp.port = parsed.port;
    user.smtp.secure = parsed.secure;
    user.smtp.user = parsed.user;
    user.smtp.from = parsed.from;
    if (parsed.pass) {
        const { iv, ciphertext } = encrypt(parsed.pass);
        user.smtp.passIv = iv;
        user.smtp.passCiphertext = ciphertext;
    }

    user.markModified('smtp');
    await user.save();
    res.json(serializeAccount(user));
}

async function clearSmtp(req, res) {
    const user = await usersDb.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    user.smtp = {};
    user.markModified('smtp');
    await user.save();
    res.json(serializeAccount(user));
}

// Tests either the not-yet-saved values in the request body, or (if the
// body is empty) whatever this user already has saved.
async function testSmtp(req, res) {
    const hasBody = req.body && Object.keys(req.body).length > 0;
    let cfg;

    if (hasBody) {
        const parsed = parseSmtpInput(req.body);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        const user = await usersDb.findById(req.session.userId);
        if (!parsed.pass) {
            const existing = user && resolveUserSmtp(user);
            if (!existing) return res.status(400).json({ error: 'pass is required' });
            parsed.pass = existing.pass;
        }
        cfg = parsed;
    } else {
        const user = await usersDb.findById(req.session.userId);
        cfg = user && resolveUserSmtp(user);
        if (!cfg) return res.status(400).json({ error: 'SMTP is not configured' });
    }

    const result = await testUserSmtp(cfg);
    res.json(result);
}

// Generates (or regenerates, invalidating whatever key existed before) this
// user's read-only report API key — see models/user.js's apiKey field and
// middleware/auth.js's requireApiKeyOrAuth. The raw key is returned here and
// only here: it's hashed before being stored, so this is the one and only
// chance to see/copy it.
async function generateApiKeyForAccount(req, res) {
    const { raw, hash, prefix } = generateApiKey();
    const user = await usersDb.setApiKey(req.session.userId, { hash, prefix });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ ...serializeAccount(user), rawApiKey: raw });
}

async function revokeApiKeyForAccount(req, res) {
    const user = await usersDb.clearApiKey(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(serializeAccount(user));
}

// ── Backups (My Account > Backups, personal data only) — mirrors
// controllers/adminController.js's site-wide equivalent against
// ctx: { scope: 'user', userId }. See services/backup/backupService.js for
// what "personal data" means here (every owner-scoped collection, filtered
// to this user's own documents).
function userCtx(req) {
    return { scope: 'user', userId: req.session.userId };
}

async function getBackupSettings(req, res) {
    const user = await usersDb.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const backup = user.backup || {};
    res.json({
        destination: backup.destination || null,
        frequency: backup.frequency || 'disabled',
        time: backup.time || '03:00',
        dayOfWeek: Number.isInteger(backup.dayOfWeek) ? backup.dayOfWeek : 0,
        retentionCount: Number.isInteger(backup.retentionCount) ? backup.retentionCount : 7,
        defaultDestination: backupService.DEFAULT_DIR
    });
}

async function updateBackupSettings(req, res) {
    const parsed = backupService.parseBackupSettingsInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const user = await usersDb.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    user.backup = parsed;
    user.markModified('backup');
    await user.save();

    await backupScheduler.reloadUser(req.session.userId);
    res.json({ ...parsed, defaultDestination: backupService.DEFAULT_DIR });
}

async function checkBackupDestination(req, res) {
    const explicit = req.body && typeof req.body.destination === 'string' ? req.body.destination.trim() : '';
    const destination = explicit || await backupService.resolveDestination(userCtx(req));
    const result = await backupService.checkDestination(destination);
    res.json({ destination, ...result });
}

async function runBackupNow(req, res) {
    const result = await backupService.runBackup(userCtx(req), { trigger: 'manual', triggeredBy: req.session.userId });
    if (result.status === 'error') return res.status(422).json({ error: result.error });
    res.json(result);
}

async function listBackupRuns(req, res) {
    const runs = await backupRunsDb.listForUser(req.session.userId);
    res.json({ runs });
}

async function listBackupFiles(req, res) {
    const result = await backupService.listBackupFiles(userCtx(req));
    res.json(result);
}

async function downloadBackupFile(req, res) {
    const { name } = req.params;
    const ctx = userCtx(req);
    if (!backupService.patternForScope(ctx).test(name)) return res.status(400).json({ error: 'Invalid backup filename' });

    const destination = await backupService.resolveDestination(ctx);
    const filePath = path.join(destination, name);
    fs.access(filePath, fs.constants.R_OK, (err) => {
        if (err) return res.status(404).json({ error: 'Backup file not found' });
        res.download(filePath, name);
    });
}

async function deleteBackupFile(req, res) {
    const { name } = req.params;
    try {
        await backupService.deleteBackupFile(userCtx(req), name);
        res.status(204).end();
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}

async function restoreFromUpload(req, res) {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await backupService.restoreFromBuffer(userCtx(req), req.file.buffer, { trigger: 'manual', triggeredBy: req.session.userId });
    if (result.status === 'error') return res.status(422).json({ error: result.error });
    res.json(result);
}

async function restoreFromFile(req, res) {
    const { name } = req.params;
    try {
        const result = await backupService.restoreFromFile(userCtx(req), name, { trigger: 'manual', triggeredBy: req.session.userId });
        if (result.status === 'error') return res.status(422).json({ error: result.error });
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
}

module.exports = {
    getAccount, updateSmtp, clearSmtp, testSmtp,
    generateApiKeyForAccount, revokeApiKeyForAccount,
    getBackupSettings, updateBackupSettings, checkBackupDestination,
    runBackupNow, listBackupRuns, listBackupFiles, downloadBackupFile, deleteBackupFile,
    restoreFromUpload, restoreFromFile
};
