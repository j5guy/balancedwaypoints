// Self-service settings for the logged-in user's own account — distinct
// from controllers/adminController.js, which manages *other* users. Only
// ever touches req.session.userId's own document.
const usersDb = require('../services/database/users');
const { encrypt } = require('../utils/secretCrypto');
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
        themeColors: user.themeColors
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

module.exports = { getAccount, updateSmtp, clearSmtp, testSmtp };
