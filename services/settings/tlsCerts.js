// Storage + validation for the admin-uploaded TLS cert/key pair. Kept
// separate from services/settings/store.js (which just holds the
// tls.enabled flag) since these are PEM files, not JSON-safe values.
// Mirrors loadout/services/settings/tlsCerts.js.
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { X509Certificate } = require('crypto');

const TLS_DIR = path.join(global.appRoot, '.secrets', 'tls');
const CERT_PATH = path.join(TLS_DIR, 'cert.pem');
const KEY_PATH = path.join(TLS_DIR, 'key.pem');

// Throws with a human-readable message if the pair is malformed or doesn't
// match — callers show this to the admin instead of applying a cert that
// would make the server unreachable.
const validate = (cert, key) => {
    let x509;
    try {
        x509 = new X509Certificate(cert);
    } catch (err) {
        throw new Error('Certificate file is not a valid PEM certificate.');
    }
    try {
        // Throws if the key isn't a valid private key, or doesn't match the cert.
        tls.createSecureContext({ cert, key });
    } catch (err) {
        throw new Error('Certificate/key pair is invalid or does not match: ' + err.message);
    }
    return {
        subject: x509.subject,
        validFrom: x509.validFrom,
        validTo: x509.validTo
    };
};

const save = (cert, key) => {
    fs.mkdirSync(TLS_DIR, { recursive: true });
    fs.writeFileSync(CERT_PATH, cert);
    fs.writeFileSync(KEY_PATH, key);
};

const remove = () => {
    fs.rmSync(CERT_PATH, { force: true });
    fs.rmSync(KEY_PATH, { force: true });
};

const load = () => {
    try {
        const cert = fs.readFileSync(CERT_PATH);
        const key = fs.readFileSync(KEY_PATH);
        const info = validate(cert, key);
        return { cert, key, info };
    } catch (err) {
        return null;
    }
};

const info = () => {
    const loaded = load();
    return loaded ? loaded.info : null;
};

module.exports = { validate, save, remove, load, info };
