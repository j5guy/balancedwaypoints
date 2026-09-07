// This app's identity when talking to the central licensing service — must
// match the `app` value used everywhere in ../licensing (trial issuance,
// validate, Stripe checkout metadata).
const APP_NAME = 'balancedwaypoints';

// LICENSE_SERVER_URL may be a single URL or a comma-separated list — a
// failover list of redundant/mirrored licensing servers (same shared secret,
// same API), not different services. See services/licensing/client.js for
// how the list is walked.
const serverUrls = (process.env.LICENSE_SERVER_URL || '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

module.exports = {
    appName: APP_NAME,
    serverUrls,
    apiSecret: process.env.LICENSE_API_SECRET || ''
};
