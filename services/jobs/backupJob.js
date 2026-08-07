const backupService = require('../backup/backupService');
const usersDb = require('../database/users');
const { sendMailAsUser } = require('../mail/userMailer');
const backupFailureEmail = require('../mail/backupFailureEmail');
const logger = require('../../utils/logger');

// ctx: { scope: 'site' } or { scope: 'user', userId }. On failure, a site
// run emails every admin; a personal run emails just that one person —
// both through sendMailAsUser, so nothing goes out unless the recipient has
// their own SMTP configured (same as every other notification in this app).
async function runScheduledBackup(ctx) {
    const result = await backupService.runBackup(ctx, { trigger: 'scheduled' });
    const label = ctx.scope === 'user' ? `personal backup for user ${ctx.userId}` : 'site backup';

    if (result.status === 'success') {
        logger.info(`Scheduled ${label} completed: ${result.file} (${result.sizeBytes} bytes) at ${result.destination}.`);
        return result;
    }

    logger.error(`Scheduled ${label} failed: ${result.error}`);
    const { subject, html } = backupFailureEmail(result.error, ctx.scope);

    if (ctx.scope === 'user') {
        const user = await usersDb.findById(ctx.userId);
        if (user) await sendMailAsUser(user, { subject, html });
    } else {
        const admins = (await usersDb.list()).filter((u) => u.isAdmin);
        for (const admin of admins) await sendMailAsUser(admin, { subject, html });
    }
    return result;
}

module.exports = runScheduledBackup;
