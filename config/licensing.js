// This app's identity when talking to the central licensing service — must
// match the `app` value used everywhere in ../licensing (trial issuance,
// validate, Stripe checkout metadata).
const APP_NAME = 'balancedwaypoints';

module.exports = {
    appName: APP_NAME,
    serverUrl: (process.env.LICENSE_SERVER_URL || '').replace(/\/+$/, ''),
    apiSecret: process.env.LICENSE_API_SECRET || ''
};
