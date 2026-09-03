const cron = require('node-cron');
const logger = require('../../utils/logger');
const { revalidate } = require('./gate');

// Re-checks the license once a day — frequent enough to notice an expired
// trial or a revoked key without needing every request to hit the network
// (middleware/license.js reads the cached result instead). Runs once
// immediately at startup too, same pattern as the other schedulers.
function start() {
    revalidate().catch((err) => logger.error('License revalidation failed: ' + err.message));
    cron.schedule('30 1 * * *', () => {
        revalidate().catch((err) => logger.error('License revalidation failed: ' + err.message));
    });
}

module.exports = start;
