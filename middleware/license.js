const licenseDb = require('../services/database/license');
const { isLicenseActive } = require('../services/licensing/gate');

// Paths that must stay reachable even with no active license: the
// activation screen itself, its API, and the CSRF-token endpoint that page
// needs before it can call that API (see public/js/apiClient.js).
const ALLOWED_PREFIXES = ['/license', '/api/license', '/api/auth/csrf-token'];

// Gates the whole app behind an active license. Mounted in server.js before
// every other route except the paths above, so an expired trial or missing
// key sends people to the activation screen instead of whatever page they
// asked for — including the login page, since a fully logged-out visitor
// shouldn't be able to tell the app is even functional.
async function requireLicense(req, res, next) {
    if (ALLOWED_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(prefix + '/'))) return next();

    const cached = await licenseDb.getCachedLicense();
    if (isLicenseActive(cached)) return next();

    if (req.path.startsWith('/api/')) {
        return res.status(402).json({ error: 'License expired or missing', licenseStatus: cached ? cached.status : 'unknown' });
    }
    res.redirect('/license');
}

module.exports = { requireLicense };
