const crypto = require('crypto');
const bcrypt = require('bcrypt');
const usersDb = require('../services/database/users');
const seedDemoUserData = require('../services/demo/seedDemoUserData');
const { establishSession } = require('./authController');
const logger = require('../utils/logger');

const showLanding = (req, res) => {
    res.render('demo/index', { title: 'Try the Demo', error: req.query.error || null });
};

// Random, not sequential/guessable — this account only holds throwaway data
// wiped nightly, but the password is still a real bcrypt-hashed credential
// like any other account's, so it shouldn't be trivially brute-forceable
// from just the email pattern.
const generateCredentials = () => ({
    email: `demo-${crypto.randomBytes(4).toString('hex')}@demo.local`,
    password: crypto.randomBytes(9).toString('base64url')
});

// Ordinary non-admin account — gets exactly the same permissions as any
// real signed-up user, which is what actually keeps a demo visitor from
// touching other users' data or instance settings, without any demo-
// specific restriction logic to maintain here. Its own starter dataset
// (accounts/categories/transactions) is generated fresh and scoped to just
// this user — see services/demo/seedDemoUserData.js.
const createDemoAccount = async (req, res) => {
    try {
        const { email, password } = generateCredentials();
        const passwordHash = await bcrypt.hash(password, 12);

        const demoUser = await usersDb.create({
            email,
            displayName: 'Demo User',
            isAdmin: false,
            isDemo: true,
            authSource: 'local',
            passwordHash,
            notifyEmail: null
        });

        await seedDemoUserData(demoUser._id);

        logger.info(`Demo account created: ${email}`, { ip: req.ip });
        establishSession(req, demoUser);
        req.session.save((err) => {
            if (err) logger.error('Session save error: ' + err.message);
            res.redirect('/');
        });
    } catch (err) {
        logger.error('demo/createDemoAccount error: ' + err.message);
        res.redirect('/demo?error=' + encodeURIComponent('Could not create a demo account — please try again.'));
    }
};

module.exports = { showLanding, createDemoAccount };
