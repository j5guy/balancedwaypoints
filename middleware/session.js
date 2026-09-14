const session = require('express-session');

const sessionConfig = session({
    secret: process.env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        // 'auto' trusts req.secure — correct whether this instance is
        // serving plain HTTP, terminating its own HTTPS (Admin > Settings,
        // see services/settings/tlsCerts.js), or sitting behind someone's
        // own TLS-terminating reverse proxy (server.js's trust proxy: true
        // makes req.secure reflect X-Forwarded-Proto in that last case).
        secure: 'auto',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 12 // 12 hours
    }
});

module.exports = sessionConfig;
