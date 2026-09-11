const { transports: winstonTransports } = require('winston');
const { Syslog } = require('winston-syslog');
const logger = require('../../utils/logger');

let current = null;

const build = (logging) => {
    if (logging.destination === 'syslog') {
        const { host, port, protocol } = logging.syslog;
        if (!host) return null;
        return new Syslog({ host, port, protocol, app_name: 'balanced-waypoints' });
    }
    if (logging.destination === 'http') {
        const { url, authHeader } = logging.http;
        if (!url) return null;
        const parsed = new URL(url);
        return new winstonTransports.Http({
            host: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            ssl: parsed.protocol === 'https:',
            headers: authHeader ? { Authorization: authHeader } : undefined
        });
    }
    return null;
};

// Removes whatever export transport was previously installed and installs a
// new one per the current settings — safe to call any time (boot, or right
// after an admin saves a settings change), no server restart involved. A
// bad host/port/url degrades to "no export transport" plus a warn log,
// never a thrown error.
const configure = (settings) => {
    if (current) {
        logger.remove(current);
        current = null;
    }

    try {
        const next = build(settings.logging);
        if (!next) return;

        // An unhandled 'error' event on an EventEmitter crashes the process —
        // must be attached before logger.add() ever sends it traffic.
        next.on('error', (err) => {
            logger.warn(`Log export transport error (${settings.logging.destination}): ${err.message}`);
        });

        logger.add(next);
        current = next;
    } catch (err) {
        logger.warn(`Failed to configure log export transport: ${err.message}`);
    }
};

module.exports = { configure };
