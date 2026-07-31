// Runs a few background jobs on cron ticks:
//  - Once a day: any active, autoEnter schedule whose nextDate has arrived
//    gets a real Transaction posted, and its nextDate advances. Non-autoEnter
//    schedules never get touched here — they only ever show up as an
//    "upcoming" reminder computed on the fly in the UI (see
//    controllers/schedulesController.js).
//  - Every 15 minutes: notifyByEmail-flagged schedules that have entered
//    their reminder window get emailed to everyone with their own SMTP
//    configured (services/jobs/scheduleReminderEmailJob.js).
//  - Weekly: an opt-in summary email (services/jobs/weeklyReportEmailJob.js).
const cron = require('node-cron');
const schedulesDb = require('../database/schedules');
const transactionsDb = require('../database/transactions');
const nextOccurrence = require('./nextOccurrence');
const runScheduleReminderEmails = require('../jobs/scheduleReminderEmailJob');
const runWeeklyReportEmails = require('../jobs/weeklyReportEmailJob');
const logger = require('../../utils/logger');

async function runDueSchedules() {
    const due = await schedulesDb.findDue();
    for (const schedule of due) {
        try {
            await transactionsDb.create({
                account: schedule.account,
                date: schedule.nextDate,
                payee: schedule.payee,
                amountCents: schedule.amountCents,
                category: schedule.category,
                splits: schedule.splits,
                notes: schedule.notes,
                schedule: schedule._id
            });

            const next = nextOccurrence(schedule.nextDate, schedule.frequency);
            const stillActive = !schedule.endDate || next <= schedule.endDate;
            await schedulesDb.update(schedule._id, {
                nextDate: next,
                active: stillActive
            });
            logger.info(`Auto-entered schedule "${schedule.name}" for ${schedule.nextDate.toISOString().slice(0, 10)}`);
        } catch (err) {
            logger.error(`Failed to auto-enter schedule "${schedule.name}": ${err.message}`);
        }
    }
}

function startScheduler() {
    // Once daily, just after midnight server time.
    cron.schedule('5 0 * * *', () => {
        runDueSchedules().catch(err => logger.error('Schedule run failed: ' + err.message));
    });
    // Every 15 minutes, so toggling "email me when due" or editing a
    // schedule's date takes effect quickly rather than waiting up to a day.
    cron.schedule('*/15 * * * *', () => {
        runScheduleReminderEmails().catch(err => logger.error('Schedule reminder email run failed: ' + err.message));
    });
    // Weekly digest — Sunday mornings, server time.
    cron.schedule('0 8 * * 0', () => {
        runWeeklyReportEmails().catch(err => logger.error('Weekly report email run failed: ' + err.message));
    });
    // Also run the auto-enter check once at boot, so a schedule due while
    // the app was down (e.g. over a restart) doesn't sit un-entered until
    // the next midnight tick.
    runDueSchedules().catch(err => logger.error('Initial schedule run failed: ' + err.message));
}

module.exports = startScheduler;
module.exports.runDueSchedules = runDueSchedules;
