const crypto = require('crypto');

// Encrypts secrets at rest in MongoDB — the LDAP bind password (Settings
// singleton) and each user's own SMTP password (embedded on their User doc).
// AES-256-GCM keyed off sessionSecret. The server needs the plaintext back
// to actually use these (bind to LDAP, send mail), so this is reversible
// encryption, not hashing — domain-separated via the HMAC label below so it
// can never collide with sessionSecret's other use signing session/CSRF cookies.
function deriveKey() {
    return crypto.createHmac('sha256', process.env.sessionSecret).update('secret-encryption-key-v1').digest();
}

function encrypt(plaintext) {
    if (!plaintext) return { iv: null, ciphertext: null };
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
    const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
        iv: iv.toString('base64'),
        ciphertext: Buffer.concat([body, authTag]).toString('base64')
    };
}

function decrypt({ iv, ciphertext }) {
    if (!iv || !ciphertext) return null;
    const data = Buffer.from(ciphertext, 'base64');
    const authTag = data.subarray(data.length - 16);
    const encrypted = data.subarray(0, data.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
