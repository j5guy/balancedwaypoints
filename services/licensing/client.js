const { appName, serverUrls } = require('../../config/licensing');

// Tries each configured server in order, falling through to the next only on
// a genuine reachability problem (network error, timeout, 5xx) — never on a
// definitive 404/403 answer, which returns immediately instead of being
// treated as "this server is down". If every server in the list fails, the
// caller sees the last one's error, same as the single-server case always
// did — gate.js's revalidate() already treats that as "unreachable" and
// keeps whatever license state was last cached, so an all-down list
// degrades exactly like a single down server always has. No shared secret
// is sent — see config/licensing.js's comment for why not.
async function post(path, body) {
    if (!serverUrls.length) throw new Error('LICENSE_SERVER_URL is not configured');

    let lastErr;
    for (const serverUrl of serverUrls) {
        try {
            const res = await fetch(`${serverUrl}${path}`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(10_000)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok && res.status !== 404 && res.status !== 403) {
                throw new Error(data.error || `Licensing service returned ${res.status}`);
            }
            return data;
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr;
}

function requestTrial(instanceId, email) {
    return post('/api/trial', { app: appName, instanceId, email });
}

function validateKey(key, instanceId) {
    return post('/api/validate', { app: appName, key, instanceId });
}

function startCheckout(email) {
    return post('/api/checkout', { app: appName, email });
}

module.exports = { requestTrial, validateKey, startCheckout };
