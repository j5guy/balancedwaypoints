const cron = require('node-cron');
const logger = require('../../utils/logger');
const resetDemoData = require('./reset');

// Only ever started when config.demoMode is on (see server.js). Runs the
// reset immediately at boot (so a freshly started demo container isn't
// carrying over stale accounts from before it restarted), then wipes
// nightly at 3am — server.js pins process.env.TZ to America/New_York, so
// node-cron's default (unspecified) timezone already resolves to Eastern.
// Mirrors loadout/services/demo/scheduler.js.
function start() {
    resetDemoData().catch((err) => logger.error('Initial demo reset failed: ' + err.message));
    cron.schedule('0 3 * * *', () => {
        resetDemoData().catch((err) => logger.error('Nightly demo reset failed: ' + err.message));
    });
}

module.exports = start;
