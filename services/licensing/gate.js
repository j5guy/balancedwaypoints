const licenseDb = require('../database/license');
const client = require('./client');
const { isOfflineToken, verifyOfflineLicense } = require('./offline');
const { appName } = require('../../config/licensing');
const logger = require('../../utils/logger');

// Whether a cached license doc currently grants access. Deliberately does
// NOT factor in lastValidationReachable/lastValidatedAt: if the licensing
// service is unreachable, this simply keeps returning whatever the last
// successful check-in said (see revalidate() below, which only overwrites
// status on a check-in that actually completed) — a self-hosted install
// isn't punished for a transient network blip or the licensing service
// being briefly down. A trial's expiresAt is still enforced purely from the
// local cache, so a trial can't be extended by cutting off network access.
function isLicenseActive(doc, now = Date.now()) {
    if (!doc || !doc.key || doc.status !== 'active') return false;
    if (doc.type === 'trial' && doc.expiresAt && new Date(doc.expiresAt).getTime() < now) return false;
    return true;
}

// Runs at startup and on a daily schedule (see scheduler.js). Requests a
// trial the first time an install has no key at all, otherwise re-validates
// the key it already has.
async function revalidate() {
    // Creates the singleton doc (and its instanceId) on first-ever call —
    // getCachedLicense below is only safe to dereference after this.
    const instanceId = await licenseDb.getOrCreateInstanceId();
    const cached = await licenseDb.getCachedLicense();

    // An offline license was already verified (and its expiry, if any, is
    // re-checked on every request by isLicenseActive) at activation time —
    // there is nothing to check in with, ever, by design.
    if (cached.key && isOfflineToken(cached.key)) return;

    if (!cached.key) {
        try {
            const trial = await client.requestTrial(instanceId);
            await licenseDb.saveValidatedLicense(trial);
        } catch (err) {
            logger.error('License trial request failed: ' + err.message + (err.cause ? ` (${err.cause})` : ''));
            await licenseDb.markUnreachable();
        }
        return;
    }

    try {
        const result = await client.validateKey(cached.key, instanceId);
        if (result && result.key) {
            await licenseDb.saveValidatedLicense(result);
        } else {
            // Licensing service responded but doesn't recognize this key for
            // this app (404/403) — an explicit answer, not a network
            // failure, so it's safe to mark it no longer active.
            await licenseDb.saveValidatedLicense({
                key: cached.key, type: cached.type, status: 'revoked',
                email: cached.email, expiresAt: cached.expiresAt
            });
        }
    } catch (err) {
        logger.error('License validation unreachable: ' + err.message + (err.cause ? ` (${err.cause})` : ''));
        await licenseDb.markUnreachable();
    }
}

// Called from routes/api/license.js when the user submits a key on the
// /license screen — unlike revalidate(), errors here should surface to the
// user rather than fail silently into "unreachable".
async function activate(key) {
    if (isOfflineToken(key)) {
        const payload = verifyOfflineLicense(key, appName);
        const result = {
            key,
            type: payload.type,
            status: 'active',
            email: payload.email,
            expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null
        };
        await licenseDb.saveValidatedLicense(result);
        return result;
    }

    const instanceId = await licenseDb.getOrCreateInstanceId();
    const result = await client.validateKey(key, instanceId);
    if (!result || !result.key || !result.valid) {
        throw new Error((result && result.error) || 'That license key is not valid.');
    }
    await licenseDb.saveValidatedLicense(result);
    return result;
}

module.exports = { isLicenseActive, revalidate, activate };
