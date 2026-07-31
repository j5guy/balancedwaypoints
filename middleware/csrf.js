const { doubleCsrf } = require('csrf-csrf');

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => process.env.sessionSecret,
    cookieName: process.env.NODE_ENV === 'production' ? '__Host-bwp.csrf' : 'bwp.csrf',
    cookieOptions: {
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
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
