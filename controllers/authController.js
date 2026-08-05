const bcrypt = require('bcrypt');
const usersDb = require('../services/database/users');
const { adminEmail, signupAllowlist } = require('../config/config');
const { resolveLdapConfig, authenticateLdap } = require('../config/ldapAuth');
const THEME_COLOR_FIELDS = require('../utils/themeColorFields');
const logger = require('../utils/logger');

const BCRYPT_ROUNDS = 12;

function establishSession(req, user) {
    req.session.userId = user._id;
    req.session.email = user.email;
    req.session.displayName = user.displayName;
    req.session.isAdmin = user.isAdmin;
    // Denormalized into the session so views/components/head.ejs can apply
    // it on every page render without a DB round-trip — see server.js's
    // res.locals.themeColors. Kept in sync on save below whenever it changes,
    // so an edit takes effect immediately rather than waiting for next login.
    req.session.themeColors = user.themeColors;
    // Denormalized so routes/pages.js's '/' redirect doesn't need a DB
    // round-trip either — kept in sync in updatePreferences below.
    req.session.homeDashboard = user.preferences.homeDashboard;
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

    const user = await usersDb.create({
        email, displayName, passwordHash, isAdmin, lastLoginAt: new Date(),
        // Defaults the notify-email used by schedule/weekly-report emails
        // (see models/user.js) to the login email — editable later from My
        // Account. LDAP accounts don't get this default (no guaranteed email
        // from the directory); see loginLdap below.
        notifyEmail: email
    });
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
    // passwordHash is only set for authSource:'local' accounts — an
    // LDAP-provisioned user sharing this email (unlikely, but possible) has
    // none, and bcrypt.compare() throws on a non-string hash rather than
    // just returning false, so this has to short-circuit first.
    const valid = user && user.passwordHash && await bcrypt.compare(password, user.passwordHash);
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

// Public — the login page uses this to decide whether to show the LDAP
// login form at all, so it isn't presented as an option when nobody's
// configured it.
async function ldapStatus(req, res) {
    const config = await resolveLdapConfig().catch(() => null);
    res.json({ enabled: !!(config && config.enabled) });
}

async function loginLdap(req, res) {
    const username = String((req.body || {}).username || '').trim();
    const password = String((req.body || {}).password || '');
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

    const config = await resolveLdapConfig();
    if (!config || !config.enabled) return res.status(400).json({ error: 'LDAP login is not enabled' });

    let entry;
    try {
        entry = await authenticateLdap(config, username, password);
    } catch (err) {
        logger.info(`LDAP login failed for "${username}": ${err.message}`);
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    let user = await usersDb.findByLdapUsername(username);
    if (!user) {
        // No guaranteed `mail` attribute in every directory — fall back to a
        // clearly-non-routable placeholder; the user sets a real notifyEmail
        // themselves from My Account before any email actually goes out.
        const email = (entry.mail || `${username}@ldap.local`).toLowerCase();
        const displayName = entry.displayName || entry.cn || username;

        const emailConflict = await usersDb.findByEmail(email);
        if (emailConflict) {
            logger.error(`LDAP login for "${username}" resolved to email "${email}", which already belongs to a different account`);
            return res.status(409).json({ error: 'An account with this email already exists — ask an admin to resolve this' });
        }

        const userCount = await usersDb.count();
        const isAdmin = userCount === 0 || email === adminEmail;
        user = await usersDb.create({
            email, displayName, isAdmin, authSource: 'ldap', ldapUsername: username, lastLoginAt: new Date()
        });
        logger.info(`New LDAP-provisioned account: ${username}${isAdmin ? ' (admin)' : ''}`);
    } else {
        user.lastLoginAt = new Date();
        await user.save();
    }

    establishSession(req, user);
    logger.info(`LDAP login: ${username}`);
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
    res.json({
        homeDashboard: user.preferences.homeDashboard,
        registerSort: user.preferences.registerSort,
        registerMask: user.preferences.registerMask,
        registerColumns: user.preferences.registerColumns,
        upcomingSchedules: user.preferences.upcomingSchedules,
        registerHistory: user.preferences.registerHistory,
        weeklyReportEmail: user.preferences.weeklyReportEmail,
        dashboard: user.preferences.dashboard,
        notifyEmail: user.notifyEmail,
        themeColors: user.themeColors
    });
}

// Only null/undefined/empty-string values are treated as "reset to
// default" — anything else must look like a hex color, so a stray typo in
// a color field can't inject arbitrary CSS into the <style> block
// views/components/head.ejs builds from this (it interpolates the value
// directly, unescaped, since a real hex color needs no escaping).
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function sanitizeThemeColorGroup(input, existing) {
    const result = {};
    for (const [key] of THEME_COLOR_FIELDS) {
        result[key] = existing[key];
        if (!(key in (input || {}))) continue;
        const value = input[key];
        if (!value) result[key] = null;
        else if (HEX_COLOR_RE.test(value)) result[key] = value;
        // Silently ignored if it's neither empty nor a valid hex color —
        // the color <input> in the UI can't produce anything else anyway.
    }
    return result;
}

// Widget types the Dashboard page (views/dashboard/index.ejs) knows how to
// render — kept here (not just client-side) so a request can't smuggle an
// arbitrary string into preferences.dashboard.widgets. Object.assign (used
// for the simpler flat sub-objects below) would replace the array wholesale
// with no validation, so this gets its own sanitizer, same reasoning as
// sanitizeThemeColorGroup above.
const DASHBOARD_WIDGETS = ['summary', 'totalIncome', 'totalExpense', 'netBudget', 'netWorth', 'cashFlow'];
const DASHBOARD_DATE_RANGES = ['month', 'last3', 'last6', 'last12', 'year', 'all'];
const DASHBOARD_ALIGNS = ['left', 'center', 'right'];
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

// Each widget instance is { id, type, accountId } — see models/user.js's
// preferences.dashboard.widgets for why these are instances rather than a
// plain type list (repeatable, per-account "totals" widgets). `id` just
// needs to be a non-empty string (the client generates it; it's an opaque
// drag-reorder/remove key, not something this needs to police the shape
// of), `type` must be one of the known widget types, and `accountId` is
// either a well-formed ObjectId string or null ("all accounts") — this
// doesn't verify the account still exists, same light-touch validation
// level as the rest of this file (a stale/deleted account id just makes
// that one widget instance render empty, not a security concern in a
// single-household app where account ids aren't secret).
function sanitizeDashboardWidgets(input) {
    const seenIds = new Set();
    const widgets = [];
    for (const w of input) {
        if (!w || typeof w.id !== 'string' || !w.id || seenIds.has(w.id)) continue;
        if (!DASHBOARD_WIDGETS.includes(w.type)) continue;
        seenIds.add(w.id);
        widgets.push({
            id: w.id,
            type: w.type,
            accountId: typeof w.accountId === 'string' && OBJECT_ID_RE.test(w.accountId) ? w.accountId : null
        });
    }
    return widgets;
}

function sanitizeDashboard(input, existing) {
    const widgets = Array.isArray(input.widgets)
        ? sanitizeDashboardWidgets(input.widgets)
        : existing.widgets;
    const dateRangePreset = DASHBOARD_DATE_RANGES.includes(input.dateRangePreset)
        ? input.dateRangePreset
        : existing.dateRangePreset;
    const align = DASHBOARD_ALIGNS.includes(input.align) ? input.align : existing.align;
    return { widgets, dateRangePreset, align };
}

async function updatePreferences(req, res) {
    const user = await usersDb.findById(req.session.userId);
    if (!user) return res.status(404).json({ error: 'Not found' });

    const { homeDashboard, registerSort, registerMask, registerColumns, upcomingSchedules, registerHistory, weeklyReportEmail, dashboard, notifyEmail, themeColors } = req.body || {};
    if (['budget', 'accounts', 'dashboard'].includes(homeDashboard)) user.preferences.homeDashboard = homeDashboard;
    if (['newest', 'oldest', 'manual'].includes(registerSort)) user.preferences.registerSort = registerSort;
    if (registerMask) Object.assign(user.preferences.registerMask, registerMask);
    if (registerColumns) Object.assign(user.preferences.registerColumns, registerColumns);
    if (upcomingSchedules) Object.assign(user.preferences.upcomingSchedules, upcomingSchedules);
    if (registerHistory) Object.assign(user.preferences.registerHistory, registerHistory);
    if (weeklyReportEmail !== undefined) user.preferences.weeklyReportEmail = !!weeklyReportEmail;
    if (dashboard) user.preferences.dashboard = sanitizeDashboard(dashboard, user.preferences.dashboard);
    // notifyEmail lives directly on the user doc (see models/user.js), not
    // under preferences, but is accepted here too so the My Account page's
    // notification-settings card can save it independent of the SMTP
    // card's fields (see controllers/accountController.js for those) — it
    // shouldn't require a valid mail server to already be configured.
    if (notifyEmail !== undefined) user.notifyEmail = String(notifyEmail).toLowerCase().trim() || null;
    if (themeColors) {
        if (themeColors.light) user.themeColors.light = sanitizeThemeColorGroup(themeColors.light, user.themeColors.light);
        if (themeColors.dark) user.themeColors.dark = sanitizeThemeColorGroup(themeColors.dark, user.themeColors.dark);
        user.markModified('themeColors');
    }
    // Mutating a nested schema object's properties directly (rather than
    // replacing it wholesale) doesn't always get picked up by Mongoose's
    // change tracking — belt-and-suspenders so the save below actually persists it.
    user.markModified('preferences');
    await user.save();

    // Denormalized copy in the session (see establishSession) needs
    // refreshing too, or a theme-color change wouldn't actually render
    // until the next login.
    req.session.themeColors = user.themeColors;
    req.session.homeDashboard = user.preferences.homeDashboard;
    req.session.save((err) => {
        if (err) logger.error('Session save error: ' + err.message);
        res.json({
            homeDashboard: user.preferences.homeDashboard,
            registerSort: user.preferences.registerSort,
            registerMask: user.preferences.registerMask,
            registerColumns: user.preferences.registerColumns,
            upcomingSchedules: user.preferences.upcomingSchedules,
            registerHistory: user.preferences.registerHistory,
            weeklyReportEmail: user.preferences.weeklyReportEmail,
            dashboard: user.preferences.dashboard,
            notifyEmail: user.notifyEmail,
            themeColors: user.themeColors
        });
    });
}

module.exports = { signup, login, loginLdap, ldapStatus, logout, me, getPreferences, updatePreferences };
