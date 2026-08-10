// Background bank sync — every 4 hours, pull new transactions for every
// user's SimpleFIN connection(s). Unlike services/backup/backupScheduler.js
// (per-user configurable time/frequency, so it manages one cron task per
// user), sync timing isn't user-configurable: a single fixed-interval task
// covers every connection, same pattern as services/schedules/scheduler.js's
// fixed jobs. A manual "Sync now" (controllers/simplefinController.js)
// covers anyone who doesn't want to wait for the next tick.
const cron = require('node-cron');
const connectionsDb = require('../database/simplefinConnections');
const { syncConnection } = require('./syncService');
const logger = require('../../utils/logger');

async function runAllSyncs() {
    const connections = await connectionsDb.listAll();
    for (const connection of connections) {
        try {
            const result = await syncConnection(connection);
            if (result.created > 0) {
                logger.info(`SimpleFIN sync: imported ${result.created} transaction(s) for connection ${connection._id}.`);
            }
        } catch (err) {
            logger.error(`SimpleFIN sync failed for connection ${connection._id}: ${err.message}`);
        }
    }
}

function startSimplefinScheduler() {
    cron.schedule('0 */4 * * *', () => {
        runAllSyncs().catch(err => logger.error('SimpleFIN scheduled sync run failed: ' + err.message));
    });
    // Also run once at boot — a connection due for sync while the app was
    // down (e.g. over a restart) doesn't sit stale until the next tick.
    runAllSyncs().catch(err => logger.error('Initial SimpleFIN sync run failed: ' + err.message));
}

module.exports = startSimplefinScheduler;
module.exports.runAllSyncs = runAllSyncs;
