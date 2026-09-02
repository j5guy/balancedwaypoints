const License = require('../../models/license');

const SINGLETON_ID = 'singleton';

async function getLicenseDoc() {
    let doc = await License.findById(SINGLETON_ID);
    if (!doc) doc = await License.create({ _id: SINGLETON_ID });
    return doc;
}

// instanceId is created lazily on first access (the schema default fills it
// in) and never regenerated — every later trial/validate call against the
// licensing service uses this same value, so a recreated container is
// recognized as the same install.
async function getOrCreateInstanceId() {
    const doc = await getLicenseDoc();
    return doc.instanceId;
}

function getCachedLicense() {
    return License.findById(SINGLETON_ID).lean();
}

async function saveValidatedLicense({ key, type, status, email, expiresAt }) {
    await License.findByIdAndUpdate(SINGLETON_ID, {
        $set: {
            key, type, status, email: email || null, expiresAt: expiresAt || null,
            lastValidatedAt: new Date(),
            lastValidationReachable: true
        }
    }, { upsert: true, runValidators: true }).exec();
}

// Called when a check-in attempt fails to reach the licensing service at
// all (as opposed to reaching it and being told the key is invalid) —
// leaves the last-known key/type/status/expiresAt untouched so
// services/licensing/gate.js's grace period has something to fall back on.
async function markUnreachable() {
    await License.findByIdAndUpdate(SINGLETON_ID, {
        $set: { lastValidationReachable: false }
    }, { upsert: true }).exec();
}

module.exports = { getOrCreateInstanceId, getCachedLicense, saveValidatedLicense, markUnreachable };
