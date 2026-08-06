// Emails a notifyByEmail-flagged schedule's own owner (if they've configured
// their own SMTP — see services/mail/userMailer.js) once it enters its
// reminder window. Schedules are per-user now (models/schedule.js's owner
// field) — this used to email every household member regardless of who the
// schedule belonged to; now it's just the one person who created it.
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

    for (const schedule of due) {
        const owner = await usersDb.findById(schedule.owner);
        if (owner) {
            const { subject, html } = scheduleReminderEmail(schedule);
            const sent = await sendMailAsUser(owner, { subject, html });
            logger.info(`Schedule reminder for "${schedule.name}": ${sent ? 'sent' : 'skipped (no SMTP configured)'} for owner ${owner.email}.`);
        }
        await schedulesDb.update(schedule._id, { lastNotifiedForDate: schedule.nextDate }, schedule.owner);
    }
}

module.exports = runScheduleReminderEmails;
