const usersDb = require('../services/database/users');
const { hashApiKey } = require('../utils/apiKeyCrypto');

const requireAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.redirect('/auth/login?redirect=' + encodeURIComponent(req.originalUrl));
};

const requireApiAuth = (req, res, next) => {
    if (req.session.userId) return next();
    res.status(401).json({ error: 'Not authenticated' });
};

const requireAdmin = (req, res, next) => {
    if (req.session.isAdmin) return next();
    res.status(403).render('error', { message: 'Admin access required' });
};

const requireApiAdmin = (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    if (req.session.isAdmin) return next();
    res.status(403).json({ error: 'Admin access required' });
};

// Lets a machine caller with no browser/cookies (e.g. a Grafana Infinity
// datasource) hit report endpoints via `Authorization: Bearer <key>` — see
// models/user.js's apiKey field. Deliberately scoped to routes/api/reports.js
// only, not the whole /api router (least privilege: a leaked read-only
// report key can't touch transactions/accounts/admin routes).
//
// Doesn't write to req.session for a key-authed request: this app's
// express-session has no persistent store configured (middleware/session.js
// — default in-memory MemoryStore, resave:false/saveUninitialized:false).
// Setting req.session.userId on a cookie-less request would make
// express-session create and try to save a brand-new orphan session on every
// single poll, leaking memory over time. req.authUserId carries the resolved
// identity instead, for either auth path.
const requireApiKeyOrAuth = async (req, res, next) => {
    if (req.session.userId) {
        req.authUserId = req.session.userId;
        return next();
    }
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    if (!match) return res.status(401).json({ error: 'Not authenticated' });
    const user = await usersDb.findByApiKeyHash(hashApiKey(match[1].trim()));
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    req.authUserId = user._id;
    usersDb.touchApiKeyLastUsed(user._id);
    next();
};

module.exports = { requireAuth, requireApiAuth, requireAdmin, requireApiAdmin, requireApiKeyOrAuth };
