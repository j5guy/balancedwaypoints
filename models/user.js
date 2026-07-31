const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    displayName: {
        type: String,
        trim: true
    },
    isAdmin: {
        type: Boolean,
        default: false
    },
    // 'ldap' accounts have no passwordHash — they authenticate against the
    // directory every time (see config/ldapAuth.js) and are auto-provisioned
    // on first successful LDAP login (services/database/users.js's
    // findOrCreateFromLdap).
    authSource: {
        type: String,
        enum: ['local', 'ldap'],
        default: 'local'
    },
    // The username this account was looked up by in LDAP — only set for
    // authSource: 'ldap'. Distinct from email, which LDAP may not reliably
    // provide (hence notifyEmail below being a separate, manually-set field
    // for LDAP accounts).
    ldapUsername: {
        type: String,
        default: null
    },
    passwordHash: {
        type: String,
        select: false
    },
    lastLoginAt: {
        type: Date
    },
    // Where schedule/weekly-report emails go (see services/mail and
    // services/jobs). Defaults to `email` for local accounts at signup time;
    // LDAP accounts have no guaranteed email from the directory, so this is
    // left null until the user sets it themselves on the My Account page.
    notifyEmail: {
        type: String,
        trim: true,
        lowercase: true,
        default: null
    },
    // Each user's own outgoing mail server (e.g. their personal Gmail with
    // an app password) — deliberately per-user rather than a shared/admin
    // singleton, so reminders go out through whichever account the
    // recipient actually wants them sent from. See services/mail/userMailer.js.
    smtp: {
        host: { type: String, trim: true, default: null },
        port: { type: Number, default: null },
        secure: { type: Boolean, default: null },
        user: { type: String, trim: true, default: null },
        from: { type: String, trim: true, default: null },
        // AES-256-GCM ciphertext — see utils/secretCrypto.js. Never
        // select()-ed back to a serializer without deliberately decrypting.
        passIv: { type: String, default: null },
        passCiphertext: { type: String, default: null }
    },
    // Per-theme overrides for a curated set of CSS custom properties (see
    // public/scss/layout/_base.scss). null/unset means "use the theme
    // default" — never store the app's hardcoded default hex here.
    themeColors: {
        light: {
            text: { type: String, default: null },
            bg: { type: String, default: null },
            accent: { type: String, default: null }
        },
        dark: {
            text: { type: String, default: null },
            bg: { type: String, default: null },
            accent: { type: String, default: null }
        }
    },
    // Register display preferences — persist per-user (not per-browser) so
    // they follow whoever's logged in across devices. Applied on every
    // account's register page (see accounts/show.ejs + public/js/register.js).
    preferences: {
        registerColumns: {
            date: { type: Boolean, default: true },
            payee: { type: Boolean, default: true },
            category: { type: Boolean, default: true },
            notes: { type: Boolean, default: true },
            tags: { type: Boolean, default: true },
            amount: { type: Boolean, default: true },
            balance: { type: Boolean, default: true },
            cleared: { type: Boolean, default: true }
        },
        upcomingSchedules: {
            enabled: { type: Boolean, default: false },
            amount: { type: Number, default: 14 },
            unit: { type: String, enum: ['days', 'months'], default: 'days' }
        },
        // Sent by services/jobs/weeklyReportEmailJob.js through this user's
        // own configured SMTP (smtp above) — requires that to be set up, same
        // as per-schedule email alerts (see models/schedule.js's notifyByEmail).
        weeklyReportEmail: { type: Boolean, default: false }
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
