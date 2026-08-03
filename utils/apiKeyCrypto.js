const crypto = require('crypto');

// Read-only API keys for external tools (e.g. a Grafana Infinity datasource
// reading /api/reports/*) — see models/user.js's apiKey field and
// middleware/auth.js's requireApiKeyOrAuth. Unlike utils/secretCrypto.js
// (reversible, for secrets the server must recover), this only ever needs to
// compare, so it's a one-way HMAC-SHA256 digest keyed off sessionSecret —
// domain-separated via the label below so it can never collide with
// sessionSecret's other uses (signing session/CSRF cookies, secretCrypto's
// own AES key). HMAC's determinism (same input always hashes the same) is
// what lets a presented key be looked up directly by its hash instead of
// bcrypt-comparing against every user's stored key — bcrypt's per-hash salt
// would rule that out, and its slowness exists to blunt brute-forcing
// low-entropy human passwords, which doesn't apply to a random 256-bit token.
function deriveKey() {
    return crypto.createHmac('sha256', process.env.sessionSecret).update('api-key-hash-v1').digest();
}

function hashApiKey(rawKey) {
    return crypto.createHmac('sha256', deriveKey()).update(rawKey).digest('hex');
}

// `prefix` is safe to store/display in plaintext — it's shown in the UI so
// an admin can recognize a configured key without ever seeing the secret
// again after this one generation.
function generateApiKey() {
    const raw = 'bwp_' + crypto.randomBytes(32).toString('hex');
    return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 12) };
}

module.exports = { generateApiKey, hashApiKey };
