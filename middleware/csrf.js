const { doubleCsrf } = require('csrf-csrf');
const { protocol } = require('../config/config');

// Not the browser-enforced __Host- prefix (which requires Secure/HTTPS) —
// this app defaults to plain HTTP (see config.js's protocol), and a
// __Host- cookie would be silently dropped by the browser under HTTP,
// breaking CSRF protection outright rather than just running less strictly.
const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => process.env.sessionSecret,
    cookieName: 'bwp.csrf',
    cookieOptions: {
        path: '/',
        sameSite: 'lax',
        secure: protocol === 'https',
        httpOnly: true
    },
    // Deliberately NOT tied to req.session.id — see middleware/session.js
    // (saveUninitialized: false means an anonymous request that never
    // touches req.session gets a fresh session id every time). The
    // double-submit cookie + HMAC secret already provides real CSRF
    // protection on its own.
    getSessionIdentifier: () => 'bwp'
});

const csrfTokenRoute = (req, res) => {
    res.json({ csrfToken: generateCsrfToken(req, res) });
};

module.exports = { generateCsrfToken, doubleCsrfProtection, csrfTokenRoute };
