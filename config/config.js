// Not a user-facing setting (removed from .env.example/the setup wizard) —
// defaults to production unless something in the environment already
// overrides it (e.g. a developer exporting NODE_ENV=development locally).
// Set as a side effect here, before session.js/csrf.js are required, so their
// own direct process.env.NODE_ENV reads see the same default.
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

module.exports = {
    appName: 'Balanced Waypoints',
    webFQDN: process.env.WEB_FQDN || 'localhost',
    webPort: parseInt(process.env.PORT, 10) || 5570,
    // Plain HTTP by default — this app can terminate its own HTTPS if you
    // upload a cert/key pair from Admin > Settings (see
    // services/settings/tlsCerts.js), or you can put your own reverse proxy
    // in front of it. Set to "https" once either of those is actually true,
    // so links this app generates itself (see appBaseUrl below) use the
    // right scheme.
    protocol: process.env.WEB_PROTOCOL === 'https' ? 'https' : 'http',
    nodeEnv: process.env.NODE_ENV,

    // Set to the email address that should be granted admin on signup. Only
    // ever flips a boolean on that one account.
    adminEmail: (process.env.ADMIN_EMAIL || '').toLowerCase().trim() || null,

    // Turns this instance into a public demo box: adds a /demo link that
    // generates a throwaway account with its own private starter dataset
    // (see services/demo/seedDemoUserData.js), and wipes the ENTIRE DATABASE
    // every night at 03:00 (services/demo/scheduler.js) — also once on
    // every process boot, not just nightly. Leave false for a real
    // self-hosted or cloud instance; there is no partial/safe way to run
    // this against data you want to keep.
    demoMode: process.env.DEMO_MODE === 'true',

    // All amounts are stored as integer cents internally — this is the only
    // symbol/format applied on top for display.
    currencySymbol: process.env.CURRENCY_SYMBOL || '$',

    // Source repo for a future update checker.
    updateCheckRepoUrl: process.env.BALANCEDWAYPOINTS_REPO_URL || 'https://github.com/j5guy/balancedwaypoints.git',

    get appBaseUrl() {
        const protocol = process.env.WEB_PROTOCOL === 'https' ? 'https' : 'http';
        return `${protocol}://${process.env.WEB_FQDN || 'localhost'}`;
    }
};
