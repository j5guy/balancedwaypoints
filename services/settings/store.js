// Runtime-editable settings for TLS and the logs/metrics export feature,
// persisted as a small JSON file under global.appRoot/.data — balanced's
// LDAP/backup admin settings live in Mongo via services/database/settings.js
// instead, but a plain JSON file keeps this readable even if Mongo is
// briefly unavailable (or, for tls.enabled, not up yet at boot — see
// server.js's startServer), same rationale as loadout's equivalent store.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(global.appRoot, '.data');
const SETTINGS_PATH = path.join(DATA_DIR, 'logExportSettings.json');

const DEFAULTS = {
    // Whether this instance is currently self-terminating HTTPS (see
    // services/settings/tlsCerts.js for the actual cert/key storage — this
    // is just the on/off flag, same split as loadout's equivalent).
    tls: {
        enabled: false
    },
    logging: {
        destination: 'none', // 'none' | 'syslog' | 'http'
        syslog: { host: null, port: 514, protocol: 'udp4' }, // winston-syslog: udp4|tcp4|tls4
        http: { url: null, authHeader: null }
    },
    metrics: {
        enabled: false, // default OFF — this app may be offered as a hosted cloud service
        token: null,
        pushgateway: { enabled: false, url: null, intervalSeconds: 60 }
    }
};

const get = () => {
    try {
        const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            ...DEFAULTS,
            ...parsed,
            logging: {
                ...DEFAULTS.logging,
                ...(parsed.logging || {}),
                syslog: { ...DEFAULTS.logging.syslog, ...((parsed.logging || {}).syslog || {}) },
                http: { ...DEFAULTS.logging.http, ...((parsed.logging || {}).http || {}) }
            },
            metrics: {
                ...DEFAULTS.metrics,
                ...(parsed.metrics || {}),
                pushgateway: { ...DEFAULTS.metrics.pushgateway, ...((parsed.metrics || {}).pushgateway || {}) }
            }
        };
    } catch (err) {
        return { ...DEFAULTS };
    }
};

// Shallow-merges `patch` onto the current settings and persists the result.
// Callers pass only the fields they're changing (e.g. { logging: { destination } }
// or { metrics: { enabled } }) — nested sub-objects (logging.syslog,
// logging.http, metrics.pushgateway) are merged too, so changing one field
// doesn't require re-specifying every sibling field.
const save = (patch) => {
    const current = get();
    const next = {
        ...current,
        ...patch,
        logging: {
            ...current.logging,
            ...(patch.logging || {}),
            syslog: { ...current.logging.syslog, ...((patch.logging || {}).syslog || {}) },
            http: { ...current.logging.http, ...((patch.logging || {}).http || {}) }
        },
        metrics: {
            ...current.metrics,
            ...(patch.metrics || {}),
            pushgateway: { ...current.metrics.pushgateway, ...((patch.metrics || {}).pushgateway || {}) }
        }
    };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
    return next;
};

module.exports = { get, save };
