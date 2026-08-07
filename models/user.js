const mongoose = require('mongoose');

// One dashboard widget instance — see preferences.dashboard.widgets below
// for the full explanation. `_id: false` since these are identified by
// their own client-generated `id` field, not Mongo's. pastAmount/pastUnit/
// futureAmount/futureUnit/thresholdCents are only meaningful for
// type:'forecast' — kept on the one shared schema rather than a
// discriminator since it's just a handful of optional numbers, not worth a
// polymorphic schema for a single widget type.
const dashboardWidgetSchema = new mongoose.Schema({
    id: { type: String, required: true },
    type: { type: String, required: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
    pastAmount: { type: Number, default: 10 },
    pastUnit: { type: String, enum: ['days', 'weeks', 'months', 'years'], default: 'days' },
    futureAmount: { type: Number, default: 6 },
    futureUnit: { type: String, enum: ['days', 'weeks', 'months', 'years'], default: 'months' },
    // $1,000.00 default low-balance threshold for the forecast widget's
    // red danger zone (public/js/dashboard.js's buildForecastSvg).
    thresholdCents: { type: Number, default: 100000 }
}, { _id: false });

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
    // Per-theme overrides for every CSS custom property the app defines
    // (see public/scss/layout/_base.scss's :root/[data-theme] blocks —
    // these field names match those variables 1:1, camelCased). null/unset
    // means "use the theme default" — never store the app's hardcoded
    // default hex here. See views/components/head.ejs for how these get
    // turned into an actual CSS override, and controllers/authController.js's
    // THEME_COLOR_FIELDS for the canonical field list both share.
    themeColors: {
        light: {
            bgBase: { type: String, default: null },
            bgSecondary: { type: String, default: null },
            bgCard: { type: String, default: null },
            bgHover: { type: String, default: null },
            border: { type: String, default: null },
            borderLight: { type: String, default: null },
            textPrimary: { type: String, default: null },
            textSecondary: { type: String, default: null },
            textMuted: { type: String, default: null },
            accent: { type: String, default: null },
            navBg: { type: String, default: null },
            navText: { type: String, default: null }
        },
        dark: {
            bgBase: { type: String, default: null },
            bgSecondary: { type: String, default: null },
            bgCard: { type: String, default: null },
            bgHover: { type: String, default: null },
            border: { type: String, default: null },
            borderLight: { type: String, default: null },
            textPrimary: { type: String, default: null },
            textSecondary: { type: String, default: null },
            textMuted: { type: String, default: null },
            accent: { type: String, default: null },
            navBg: { type: String, default: null },
            navText: { type: String, default: null }
        }
    },
    // Read-only API access for external tools (e.g. a Grafana Infinity
    // datasource reading /api/reports/*) — see middleware/auth.js's
    // requireApiKeyOrAuth and utils/apiKeyCrypto.js. `hash` is an HMAC-SHA256
    // digest, not the key itself — bcrypt (this app's password convention)
    // is deliberately not used here since its cost exists to blunt
    // brute-forcing low-entropy human passwords, which doesn't apply to a
    // random 256-bit token, and HMAC's determinism is what lets a request's
    // key be looked up directly by hash instead of bcrypt-comparing against
    // every user. `prefix` is safe to display in the UI — it's derived from
    // the raw key but isn't the secret itself.
    apiKey: {
        hash: { type: String, default: null, select: false },
        prefix: { type: String, default: null },
        createdAt: { type: Date, default: null },
        lastUsedAt: { type: Date, default: null }
    },
    // Register display preferences — persist per-user (not per-browser) so
    // they follow whoever's logged in across devices. Applied on every
    // account's register page (see accounts/show.ejs + public/js/register.js).
    preferences: {
        // Which page '/' redirects to after login (routes/pages.js).
        homeDashboard: { type: String, enum: ['budget', 'accounts', 'dashboard'], default: 'budget' },
        // How the register orders its rows — see services/database/transactions.js's
        // SORTS. 'manual' follows the drag-and-drop sortOrder instead of date.
        registerSort: { type: String, enum: ['newest', 'oldest', 'manual'], default: 'newest' },
        // Redacts amount/balance display in the register (public/js/register.js)
        // behind a fixed-width placeholder — e.g. for screen-sharing. Never
        // affects what's stored/computed, only what's rendered.
        registerMask: {
            amount: { type: Boolean, default: false },
            balance: { type: Boolean, default: false }
        },
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
            unit: { type: String, enum: ['days', 'months', 'years'], default: 'days' }
        },
        // How far back the register loads real transactions from — mirrors
        // upcomingSchedules' shape but looking the other direction in time.
        // Disabled by default so existing registers keep showing full
        // history until a user opts into a rolling window.
        registerHistory: {
            enabled: { type: Boolean, default: false },
            amount: { type: Number, default: 3 },
            unit: { type: String, enum: ['days', 'months', 'years'], default: 'months' }
        },
        // Sent by services/jobs/weeklyReportEmailJob.js through this user's
        // own configured SMTP (smtp above) — requires that to be set up, same
        // as per-schedule email alerts (see models/schedule.js's notifyByEmail).
        weeklyReportEmail: { type: Boolean, default: false },
        // The "Dashboard" page's (views/dashboard/index.ejs) widget picker —
        // an ORDERED list of widget INSTANCES (order = display order,
        // absence = hidden), not x/y/w/h: the dashboard supports
        // drag-to-reorder only, no free resize (see public/js/dashboard.js —
        // reorder uses the same native-HTML5-drag public/js/dragReorder.js
        // already used on Budget/Register, which needs no inline style
        // writes and so no CSP change, unlike a real resize grid would).
        // Each instance has its own client-generated `id` (not Mongo's _id —
        // simpler to keep stable across an unsaved reorder than round-
        // tripping a server-assigned id) because the "totals" widget types
        // (summary/totalIncome/totalExpense/netBudget) are repeatable: a
        // household can add one per account plus an overall one, each
        // independently scoped via `accountId` (null = all accounts). The
        // trend widgets (netWorth/cashFlow) aren't account-scoped — their
        // report endpoints only ever compute across the whole household —
        // so the UI only ever lets those two exist as a single toggled
        // instance, not added repeatedly.
        // Validated server-side against a fixed whitelist in
        // controllers/authController.js's updatePreferences before save,
        // same as themeColors below — Object.assign wouldn't merge an array
        // sensibly, so this needs a real sanitizer rather than the shallow
        // merge the simpler boolean sub-objects above get.
        dashboard: {
            widgets: {
                type: [dashboardWidgetSchema],
                default: () => [
                    { id: 'summary', type: 'summary', accountId: null },
                    { id: 'totalIncome', type: 'totalIncome', accountId: null },
                    { id: 'totalExpense', type: 'totalExpense', accountId: null },
                    { id: 'netBudget', type: 'netBudget', accountId: null },
                    { id: 'netWorth', type: 'netWorth', accountId: null },
                    { id: 'cashFlow', type: 'cashFlow', accountId: null }
                ]
            },
            dateRangePreset: {
                type: String,
                enum: ['month', 'last3', 'last6', 'last12', 'year', 'all'],
                default: 'month'
            },
            // Text alignment for every widget's heading/values — one setting
            // for the whole dashboard rather than per-widget, to keep
            // preferences.dashboard.widgets a plain ordered list of type
            // strings instead of needing per-item config objects.
            align: {
                type: String,
                enum: ['left', 'center', 'right'],
                default: 'center'
            }
        }
    }
}, { timestamps: true });

// Sparse since most users never generate a key — only indexes the docs that
// actually have one, and is what makes requireApiKeyOrAuth's per-request
// lookup (find the user by this exact hash) an indexed O(1) query.
userSchema.index({ 'apiKey.hash': 1 }, { sparse: true });

module.exports = mongoose.model('User', userSchema);
