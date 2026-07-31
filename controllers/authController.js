const bcrypt = require('bcrypt');
const usersDb = require('../services/database/users');
const { adminEmail, signupAllowlist } = require('../config/config');
const logger = require('../utils/logger');

const BCRYPT_ROUNDS = 12;

function establishSession(req, user) {
    req.session.userId = user._id;
    req.session.email = user.email;
    req.session.displayName = user.displayName;
    req.session.isAdmin = user.isAdmin;
}

function isAllowedToSignUp(email) {
    if (email === adminEmail) return true;
    if (signupAllowlist.length === 0) return true;
    return signupAllowlist.includes(email);
}

async function signup(req, res) {
    const email = String((req.body || {}).email || '').toLowerCase().trim();
    const password = String((req.body || {}).password || '');
    const displayName = String((req.body || {}).displayName || '').trim() || email.split('@')[0];

    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!isAllowedToSignUp(email)) return res.status(403).json({ error: 'This email is not authorized to sign up' });

    const existing = await usersDb.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const userCount = await usersDb.count();
    const isAdmin = userCount === 0 || email === adminEmail;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await usersDb.create({ email, displayName, passwordHash, isAdmin, lastLoginAt: new Date() });
    establishSession(req, user);
    logger.info(`New signup: ${email}${isAdmin ? ' (admin)' : ''}`);
    req.session.save((err) => {
        if (err) logger.error('Session save error: ' + err.message);
        res.status(201).json({ email: user.email, displayName: user.displayName, isAdmin: user.isAdmin });
    });
}

async function login(req, res) {
    const email = String((req.body || {}).email || '').toLowerCase().trim();
    const password = String((req.body || {}).password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await usersDb.findByEmailWithPassword(email);
    const valid = user && await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    user.lastLoginAt = new Date();
    await user.save();
    establishSession(req, user);
    logger.info(`Login: ${email}`);
    req.session.save((err) => {
        if (err) logger.error('Session save error: ' + err.message);
        res.json({ email: user.email, displayName: user.displayName, isAdmin: user.isAdmin });
    });
}

function logout(req, res) {
    const email = req.session.email;
    req.session.destroy((err) => {
        if (err) logger.error('Logout error: ' + err.message);
        res.clearCookie('connect.sid');
        logger.info(`Logout: ${email}`);
        res.json({ ok: true });
    });
}

function me(req, res) {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ email: req.session.email, displayName: req.session.displayName, isAdmin: req.session.isAdmin });
}

// Register display preferences (which columns show, whether/how far out to
// show upcoming schedules) — persisted on the User doc so they follow
// whoever's logged in, not tied to one browser. See models/user.js.
async function getPreferences(req, res) {
    const user = await usersDb.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user.preferences);
}

async function updatePreferences(req, res) {
    const user = await usersDb.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });

    const { registerColumns, upcomingSchedules } = req.body || {};
    if (registerColumns) Object.assign(user.preferences.registerColumns, registerColumns);
    if (upcomingSchedules) Object.assign(user.preferences.upcomingSchedules, upcomingSchedules);
    // Mutating a nested schema object's properties directly (rather than
    // replacing it wholesale) doesn't always get picked up by Mongoose's
    // change tracking — belt-and-suspenders so the save below actually persists it.
    user.markModified('preferences');
    await user.save();
    res.json(user.preferences);
}

module.exports = { signup, login, logout, me, getPreferences, updatePreferences };
