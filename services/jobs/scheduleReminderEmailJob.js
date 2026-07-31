// Emails everyone with their own SMTP configured (see services/mail/userMailer.js)
// once a notifyByEmail-flagged schedule enters its own reminder window.
// Household-wide by design: a schedule isn't owned by one person, so
// "email me when due" (the checkbox on the schedule itself) means everyone
// who's actually hooked up a mail server, not just whoever created it.
const schedulesDb = require('../database/schedules');
const usersDb = require('../database/users');
const { sendMailAsUser } = require('../mail/userMailer');
const scheduleReminderEmail = require('../mail/scheduleReminderEmail');
const logger = require('../../utils/logger');

async function runScheduleReminderEmails() {
    const candidates = await schedulesDb.findNotifiable();
    // lastNotifiedForDate dedups by exact nextDate value — once nextDate
    // itself advances (auto-enter) or is edited, this naturally re-arms.
    const due = candidates.filter((s) => !s.lastNotifiedForDate || s.lastNotifiedForDate.getTime() !== new Date(s.nextDate).getTime());
    if (due.length === 0) return;

    const users = await usersDb.list();

    for (const schedule of due) {
        const { subject, html } = scheduleReminderEmail(schedule);
        let sentCount = 0;
        for (const user of users) {
            const sent = await sendMailAsUser(user, { subject, html });
            if (sent) sentCount++;
        }
        await schedulesDb.update(schedule._id, { lastNotifiedForDate: schedule.nextDate });
        logger.info(`Schedule reminder for "${schedule.name}": sent to ${sentCount}/${users.length} user(s).`);
    }
}

module.exports = runScheduleReminderEmails;
