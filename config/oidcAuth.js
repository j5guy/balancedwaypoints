// Generic OIDC (Authentik/Keycloak/Authelia/etc — anything that publishes a
// standard /.well-known/openid-configuration document), driven through
// openid-client. Pinned to openid-client@5 in package.json — v6 dropped
// CommonJS support and this codebase is require()-based throughout, same
// reasoning as config/ldapAuth.js choosing ldapjs directly over a
// passport strategy: full control over a config that can change at runtime
// from Admin > OIDC without a restart.
const { Issuer, generators } = require('openid-client');
const settingsDb = require('../services/database/settings');

// Discovery is a network round-trip to the issuer's well-known document —
// worth caching the built Client across requests, but only as long as the
// resolved config hasn't changed underneath it (an admin can edit Settings >
// OIDC at any time). Keyed by a JSON fingerprint of the resolved config
// rather than just issuerUrl, so a clientId/secret/redirect change also busts it.
let cached = null; // { fingerprint, client }

// Settings saved from Admin > OIDC (services/database/settings.js) take
// priority over .env, so an admin can set up or change OIDC without a
// redeploy; .env remains the bootstrap/fallback path for a fresh install
// (and the only way to configure it during the guided setup wizard) before
// anyone has visited the settings page.
async function resolveOidcConfig() {
    const dbSettings = await settingsDb.getOidcSettings();
    if (dbSettings) return dbSettings;

    if (process.env.OIDC_ISSUER_URL) {
        return {
            enabled: process.env.OIDC_ENABLED === 'true',
            issuerUrl: process.env.OIDC_ISSUER_URL,
            clientId: process.env.OIDC_CLIENT_ID,
            clientSecret: process.env.OIDC_CLIENT_SECRET,
            scopes: process.env.OIDC_SCOPES || 'openid profile email'
        };
    }
    return null;
}

function redirectUri() {
    const { appBaseUrl } = require('./config');
    return `${appBaseUrl}/auth/oidc/callback`;
}

async function getClient(config) {
    const fingerprint = JSON.stringify(config);
    if (cached && cached.fingerprint === fingerprint) return cached.client;

    const issuer = await Issuer.discover(config.issuerUrl);
    const client = new issuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: [redirectUri()],
        response_types: ['code']
    });
    cached = { fingerprint, client };
    return client;
}

// Builds the authorization redirect URL plus the PKCE verifier/state the
// caller must stash in session to validate the callback. PKCE is used even
// though a confidential client already has a client_secret — defense in
// depth against authorization-code interception, and some IdPs require it.
async function buildAuthorizationRequest() {
    const config = await resolveOidcConfig();
    if (!config || !config.enabled) throw new Error('OIDC login is not enabled');

    const client = await getClient(config);
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();

    const url = client.authorizationUrl({
        scope: config.scopes || 'openid profile email',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state
    });

    return { url, codeVerifier, state };
}

// Exchanges the callback's ?code for tokens and returns the ID token's
// claims (sub, email, name, ...) — throws on any mismatch (state, PKCE, or
// IdP-reported error).
async function handleCallback(req, { codeVerifier, state }) {
    const config = await resolveOidcConfig();
    if (!config || !config.enabled) throw new Error('OIDC login is not enabled');

    const client = await getClient(config);
    const params = client.callbackParams(req);
    const tokenSet = await client.callback(redirectUri(), params, { code_verifier: codeVerifier, state });
    return tokenSet.claims();
}

module.exports = { resolveOidcConfig, buildAuthorizationRequest, handleCallback };
