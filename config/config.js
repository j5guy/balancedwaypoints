// Not a user-facing setting (removed from .env.example/the setup wizard) —
// defaults to production unless something in the environment already
// overrides it (e.g. a developer exporting NODE_ENV=development locally).
// Set as a side effect here, before session.js/csrf.js are required, so their
// own direct process.env.NODE_ENV reads see the same default.
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

module.exports = {
    appName: 'Balanced Waypoints',
    webFQDN: process.env.WEB_FQDN || 'localhost',
    // Not user-configurable (removed from .env.example/the setup wizard) —
    // whichever nginx fronts this app (bundled or an existing host nginx)
    // always proxies to this fixed port; NGINX_HTTPS_PORT/HOST_NGINX_IP_PORT
    // are what a user actually picks a port for.
    webPort: 5570,
    nodeEnv: process.env.NODE_ENV,

    // Set to the email address that should be granted admin on signup. Only
    // ever flips a boolean on that one account.
    adminEmail: (process.env.ADMIN_EMAIL || '').toLowerCase().trim() || null,

    // Comma-separated list of emails allowed to sign up. Empty = open signup
    // (fine for a single-household internal deployment; set this to lock it
    // down once everyone in the household has an account).
    signupAllowlist: (process.env.SIGNUP_ALLOWLIST || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean),

    // All amounts are stored as integer cents internally — this is the only
    // symbol/format applied on top for display.
    currencySymbol: process.env.CURRENCY_SYMBOL || '$',

    // Where update.sh/install.sh pull releases from — reused here as the
    // source of truth for a future update checker, so both stay in sync.
    updateCheckRepoUrl: process.env.BALANCEDWAYPOINTS_REPO_URL || 'https://github.com/j5guy/balancedwaypoints.git',

    get appBaseUrl() {
        return `https://${process.env.WEB_FQDN || 'localhost'}`;
    }
};
