const crypto = require('crypto');

const PREFIX = 'AWPOFFLINE';

function loadPublicKey() {
    const raw = process.env.LICENSE_OFFLINE_PUBLIC_KEY_JWK;
    if (!raw) return null;
    try {
        return crypto.createPublicKey({ key: JSON.parse(raw), format: 'jwk' });
    } catch (err) {
        throw new Error('LICENSE_OFFLINE_PUBLIC_KEY_JWK is not valid JSON: ' + err.message);
    }
}

function isOfflineToken(key) {
    return typeof key === 'string' && key.startsWith(PREFIX + '.');
}

// Verifies the signature — and only the signature — entirely locally, no
// network call. Returns the decoded payload on success, throws otherwise.
// Deliberately never contacts ../../licensing: that's the whole point of an
// offline license (see ../../licensing/README.md's "Cloud vs self-hosted"
// section for the sibling design note on the license-key system generally).
function verifyOfflineLicense(token, expectedApp) {
    const publicKey = loadPublicKey();
    if (!publicKey) throw new Error('Offline licenses are not configured for this install');

    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX) throw new Error('Not a recognized offline license token');
    const [, payloadB64, signatureB64] = parts;

    const signature = Buffer.from(signatureB64, 'base64url');
    const verified = crypto.verify(null, Buffer.from(payloadB64, 'utf8'), publicKey, signature);
    if (!verified) throw new Error('Offline license signature is invalid');

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.app !== expectedApp) throw new Error('This offline license is not valid for this app');
    if (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now()) throw new Error('This offline license has expired');

    return payload;
}

module.exports = { isOfflineToken, verifyOfflineLicense };
