const client = require('prom-client');
const logger = require('../../utils/logger');
const { register } = require('./registry');

let timer = null;

const stop = () => {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
};

// Restarts the push loop from scratch on every call, so a settings change
// (new URL, new interval, or turning it off) takes effect immediately with
// no server restart. A temporarily unreachable gateway logs a warning and
// keeps retrying on the next tick — it must never crash the app.
const start = (settings) => {
    stop();
    const { enabled, url, intervalSeconds } = settings.metrics.pushgateway;
    if (!enabled || !url) return;

    const gateway = new client.Pushgateway(url, {}, register);
    timer = setInterval(() => {
        gateway.pushAdd({ jobName: 'balanced-waypoints' }).catch((err) => {
            logger.warn('Pushgateway push failed: ' + err.message);
        });
    }, Math.max(1, intervalSeconds) * 1000);
};

module.exports = { start, stop };
