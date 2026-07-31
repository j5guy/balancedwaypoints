const usersDb = require('../database/users');
const { sendMailAsUser } = require('../mail/userMailer');
const weeklyReportEmail = require('../mail/weeklyReportEmail');
const logger = require('../../utils/logger');

async function runWeeklyReportEmails() {
    const users = await usersDb.list();
    const recipients = users.filter((u) => u.preferences && u.preferences.weeklyReportEmail);
    if (recipients.length === 0) return;

    const { subject, html } = await weeklyReportEmail();
    let sentCount = 0;
    for (const user of recipients) {
        const sent = await sendMailAsUser(user, { subject, html });
        if (sent) sentCount++;
    }
    logger.info(`Weekly report email: sent to ${sentCount}/${recipients.length} opted-in user(s).`);
}

module.exports = runWeeklyReportEmails;
