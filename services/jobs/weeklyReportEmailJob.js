const usersDb = require('../database/users');
const { sendMailAsUser } = require('../mail/userMailer');
const weeklyReportEmail = require('../mail/weeklyReportEmail');
const logger = require('../../utils/logger');

async function runWeeklyReportEmails() {
    const users = await usersDb.list();
    const recipients = users.filter((u) => u.preferences && u.preferences.weeklyReportEmail);
    if (recipients.length === 0) return;

    // Each recipient's report is now their own — accounts/spending are
    // per-user (models/account.js's owner field), so a global "the
    // household's report" no longer means anything.
    let sentCount = 0;
    for (const user of recipients) {
        const { subject, html } = await weeklyReportEmail(user._id);
        const sent = await sendMailAsUser(user, { subject, html });
        if (sent) sentCount++;
    }
    logger.info(`Weekly report email: sent to ${sentCount}/${recipients.length} opted-in user(s).`);
}

module.exports = runWeeklyReportEmails;
