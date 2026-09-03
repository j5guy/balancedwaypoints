const { appName, serverUrl, apiSecret } = require('../../config/licensing');

async function post(path, body) {
    if (!serverUrl) throw new Error('LICENSE_SERVER_URL is not configured');
    const res = await fetch(`${serverUrl}${path}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-license-secret': apiSecret
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 404 && res.status !== 403) {
        throw new Error(data.error || `Licensing service returned ${res.status}`);
    }
    return data;
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
