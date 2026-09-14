// Deliberately in-memory, not Mongo-backed — this only needs to survive
// until the next request, and the whole database gets wiped nightly anyway
// (see services/demo/scheduler.js), so there's nothing worth persisting
// across a restart. Caps how many demo accounts one IP can spin up per
// window, so a script can't quietly flood the app with junk accounts
// between nightly resets. Mirrors loadout/middleware/demoRateLimit.js.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 3;

const attemptsByIp = new Map();

const demoRateLimit = (req, res, next) => {
    const now = Date.now();
    const ip = req.ip;
    const attempts = (attemptsByIp.get(ip) || []).filter(t => now - t < WINDOW_MS);

    if (attempts.length >= MAX_PER_WINDOW) {
        return res.status(429).render('error', {
            message: 'Too many demo accounts requested from this address — please try again later.'
        });
    }

    attempts.push(now);
    attemptsByIp.set(ip, attempts);
    next();
};

module.exports = demoRateLimit;
