(function () {
    const errorBox = document.getElementById('account-error');
    if (!errorBox) return;
    const successBox = document.getElementById('account-success');

    function showError(err) {
        successBox.hidden = true;
        errorBox.textContent = (err && err.message) || 'Something went wrong';
        errorBox.hidden = false;
    }
    function showSuccess(msg) {
        errorBox.hidden = true;
        successBox.textContent = msg;
        successBox.hidden = false;
    }

    // Doesn't touch the one-time reveal box (#api-key-reveal) — that's only
    // ever shown right after a successful generate call, in the handler
    // below, never re-populated from a plain load/refresh.
    function applyApiKeyStatus(apiKey) {
        const statusEl = document.getElementById('api-key-status');
        if (!apiKey || !apiKey.configured) {
            statusEl.textContent = 'No API key generated yet.';
            return;
        }
        const lastUsed = apiKey.lastUsedAt ? window.BWDate.formatDate(apiKey.lastUsedAt) : 'never';
        statusEl.textContent = `Key ${apiKey.prefix}… — generated ${window.BWDate.formatDate(apiKey.createdAt)}, last used ${lastUsed}.`;
    }

    async function load() {
        try {
            const account = await window.BWApi.apiFetch('/api/account');
            applyApiKeyStatus(account.apiKey);
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('generate-api-key-btn').addEventListener('click', async () => {
        if (!confirm('Generate a new API key? Any existing key stops working immediately.')) return;
        try {
            const account = await window.BWApi.apiFetch('/api/account/api-key', { method: 'POST' });
            applyApiKeyStatus(account.apiKey);
            document.getElementById('api-key-value').value = account.rawApiKey;
            document.getElementById('api-key-reveal').hidden = false;
            showSuccess('API key generated — copy it now, it won\'t be shown again.');
        } catch (err) {
            showError(err);
        }
    });

    document.getElementById('revoke-api-key-btn').addEventListener('click', async () => {
        if (!confirm('Revoke your API key? Anything using it (e.g. a Grafana datasource) will stop working.')) return;
        try {
            const account = await window.BWApi.apiFetch('/api/account/api-key', { method: 'DELETE' });
            applyApiKeyStatus(account.apiKey);
            document.getElementById('api-key-reveal').hidden = true;
            showSuccess('API key revoked.');
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
