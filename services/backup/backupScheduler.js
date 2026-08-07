// Unlike services/schedules/scheduler.js's fixed jobs, backup schedules are
// admin/user-configurable at runtime, so the underlying cron task(s) have to
// be torn down and rebuilt whenever settings change. There are two kinds:
//  - One site-wide task (Admin > Backups), reloaded via reloadSite().
//  - Up to one task per user (My Account > Backups), reloaded via
//    reloadUser(userId) whenever that person saves their own settings, and
//    stopped via stopUser(userId) when their account is deleted.
// reloadAll() rebuilds everything at boot (server.js).
const cron = require('node-cron');
const settingsDb = require('../database/settings');
const usersDb = require('../database/users');
const runScheduledBackup = require('../jobs/backupJob');
const logger = require('../../utils/logger');

let siteTask = null;
const userTasks = new Map();

function buildCronExpression({ frequency, time, dayOfWeek }) {
    const [hh, mm] = String(time || '03:00').split(':').map((n) => parseInt(n, 10));
    const hour = Number.isInteger(hh) && hh >= 0 && hh <= 23 ? hh : 3;
    const minute = Number.isInteger(mm) && mm >= 0 && mm <= 59 ? mm : 0;

    if (frequency === 'daily') return `${minute} ${hour} * * *`;
    if (frequency === 'weekly') {
        const dow = Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6 ? dayOfWeek : 0;
        return `${minute} ${hour} * * ${dow}`;
    }
    return null;
}

async function reloadSite() {
    if (siteTask) {
        siteTask.stop();
        siteTask = null;
    }

    const settings = await settingsDb.getBackupSettings();
    const expression = buildCronExpression(settings);
    if (!expression) {
        logger.info('Scheduled site backup: disabled.');
        return;
    }

    siteTask = cron.schedule(expression, () => {
        runScheduledBackup({ scope: 'site' }).catch((err) => logger.error('Scheduled site backup failed: ' + err.message));
    });
    logger.info(`Scheduled site backup armed: "${expression}" (${settings.frequency} at ${settings.time}).`);
}

function stopUser(userId) {
    const key = String(userId);
    const existing = userTasks.get(key);
    if (existing) {
        existing.stop();
        userTasks.delete(key);
    }
}

async function reloadUser(userId) {
    const key = String(userId);
    stopUser(key);

    const user = await usersDb.findById(userId);
    if (!user) return;

    const expression = buildCronExpression(user.backup || {});
    if (!expression) return;

    const task = cron.schedule(expression, () => {
        runScheduledBackup({ scope: 'user', userId: key }).catch((err) => logger.error(`Scheduled backup for user ${key} failed: ` + err.message));
    });
    userTasks.set(key, task);
    logger.info(`Scheduled personal backup armed for user ${key}: "${expression}".`);
}

async function reloadAllUsers() {
    const users = await usersDb.list();
    for (const user of users) await reloadUser(user._id);
}

async function reloadAll() {
    await reloadSite();
    await reloadAllUsers();
}

module.exports = { reloadAll, reloadSite, reloadUser, stopUser };
