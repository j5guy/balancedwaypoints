const rateLimit = require('express-rate-limit');

const make = (opts) => rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...opts
});

// Kept fairly generous — this is a small self-hosted household deployment,
// not a public SaaS — but still bounds brute-force attempts.
const loginLimiter = make({ windowMs: 15 * 60 * 1000, limit: 10 });
const signupLimiter = make({ windowMs: 60 * 60 * 1000, limit: 10 });

// Generous baseline applied to the whole /api router as defense-in-depth.
const apiBaselineLimiter = make({ windowMs: 5 * 60 * 1000, limit: 600 });

module.exports = { loginLimiter, signupLimiter, apiBaselineLimiter };
