// Per-user outgoing mail — deliberately not a shared/admin-configured
// server (contrast fondwaypoints' config/mailer.js, a household-wide
// singleton): each person hooks up their own SMTP (their own Gmail app
// password, etc.) from the My Account page, and reminders go out through
// whichever account the recipient actually wants them sent from.
const nodemailer = require('nodemailer');
const logger = require('../../utils/logger');
const { decrypt } = require('../../utils/secretCrypto');

function buildTransporterOptions({ host, port, secure, user, pass }) {
    return {
        host,
        port: Number(port) || 587,
        secure: secure === null || secure === undefined ? Number(port) === 465 : !!secure,
        auth: { user, pass }
    };
}

// null if this user hasn't configured their own SMTP yet.
function resolveUserSmtp(user) {
    const smtp = user.smtp || {};
    if (!smtp.host || !smtp.user) return null;
    const pass = decrypt({ iv: smtp.passIv, ciphertext: smtp.passCiphertext });
    if (!pass) return null;
    return { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, from: smtp.from, pass };
}

// Sends through this user's own configured server, to their own notifyEmail
// (falling back to their login email if that's unset). No-ops (logging why)
// if either is missing — callers (the notification jobs) just skip a user
// silently rather than treating this as an error.
async function sendMailAsUser(user, { subject, html }) {
    const cfg = resolveUserSmtp(user);
    const to = user.notifyEmail || user.email;
    if (!cfg) {
        logger.info(`Email skipped for ${user.email} (no SMTP configured): subject="${subject}"`);
        return false;
    }
    if (!to) {
        logger.info(`Email skipped for ${user.email} (no notify address set): subject="${subject}"`);
        return false;
    }

    const transporter = nodemailer.createTransport(buildTransporterOptions(cfg));
    try {
        await transporter.sendMail({ from: cfg.from || cfg.user, to, subject, html });
        return true;
    } catch (err) {
        logger.error(`Failed to send email to ${to}: ${err.message}`);
        return false;
    } finally {
        transporter.close();
    }
}

// Used by the My Account "Test connection" button.
async function testUserSmtp(cfg) {
    const transporter = nodemailer.createTransport({
        ...buildTransporterOptions(cfg),
        connectionTimeout: 5000,
        greetingTimeout: 5000
    });
    try {
        await transporter.verify();
        return { ok: true };
    } catch (err) {
        return { ok: false, message: err.message };
    } finally {
        transporter.close();
    }
}

module.exports = { resolveUserSmtp, sendMailAsUser, testUserSmtp, buildTransporterOptions };
