(function () {
    const errorBox = document.getElementById('oidc-error');
    if (!errorBox) return;
    const successBox = document.getElementById('oidc-success');

    document.getElementById('oidc-redirect-uri').textContent = window.location.origin + '/auth/oidc/callback';

    function showError(err) {
        successBox.hidden = true;
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }
    function showSuccess(msg) {
        errorBox.hidden = true;
        successBox.textContent = msg;
        successBox.hidden = false;
    }

    function readForm() {
        return {
            enabled: document.getElementById('oidc-enabled').checked,
            issuerUrl: document.getElementById('oidc-issuer-url').value.trim(),
            clientId: document.getElementById('oidc-client-id').value.trim(),
            clientSecret: document.getElementById('oidc-client-secret').value,
            scopes: document.getElementById('oidc-scopes').value.trim()
        };
    }

    function applySettings(cfg) {
        document.getElementById('oidc-enabled').checked = !!cfg.enabled;
        document.getElementById('oidc-issuer-url').value = cfg.issuerUrl || '';
        document.getElementById('oidc-client-id').value = cfg.clientId || '';
        document.getElementById('oidc-client-secret').value = '';
        document.getElementById('oidc-client-secret-hint').hidden = !cfg.hasClientSecret;
        document.getElementById('oidc-scopes').value = cfg.scopes || 'openid profile email';
    }

    async function load() {
        try {
            const cfg = await window.BWApi.apiFetch('/api/admin/settings/oidc');
            applySettings(cfg);
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('save-oidc-btn').addEventListener('click', async () => {
        try {
            const cfg = await window.BWApi.apiFetch('/api/admin/settings/oidc', { method: 'PUT', body: readForm() });
            applySettings(cfg);
            showSuccess('OIDC settings saved.');
        } catch (err) {
            showError(err);
        }
    });

    document.getElementById('reset-oidc-btn').addEventListener('click', async () => {
        if (!confirm('Disable OIDC and clear the saved configuration?')) return;
        try {
            const cfg = await window.BWApi.apiFetch('/api/admin/settings/oidc', { method: 'DELETE' });
            applySettings(cfg);
            showSuccess('OIDC settings cleared.');
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
