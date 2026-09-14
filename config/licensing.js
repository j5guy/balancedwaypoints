// This app's identity when talking to the central licensing service — must
// match the `app` value used everywhere in ../licensing (trial issuance,
// validate, Stripe checkout metadata).
const APP_NAME = 'balancedwaypoints';

// Always the real allthewaypoints licensing service — there is no "local"
// or per-install licensing server, self-hosted or otherwise.
// LICENSE_SERVER_URL only exists as an override for a comma-separated
// failover list of redundant/mirrored instances of that SAME service, never
// a different service — see services/licensing/client.js for how the list
// is walked.
//
// There is no shared API secret here on purpose — an earlier version of
// this app sent one (`x-license-secret`), but that never actually protected
// anything: it was one secret shared by every app and every customer, baked
// into software distributed to people running it on their own hardware, so
// any self-hosted install leaking it would have compromised the licensing
// service for everyone. /api/trial and /api/validate on that service are
// public now, protected by email-gating and rate limiting on its side
// instead — see ../../licensing/routes/api.js.
const DEFAULT_LICENSE_SERVER_URL = 'https://licensing.allthewaypoints.com';
const serverUrls = (process.env.LICENSE_SERVER_URL || DEFAULT_LICENSE_SERVER_URL)
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

module.exports = {
    appName: APP_NAME,
    serverUrls
};
