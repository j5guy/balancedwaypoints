const session = require('express-session');

const sessionConfig = session({
    secret: process.env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 12 // 12 hours
    }
});

module.exports = sessionConfig;
