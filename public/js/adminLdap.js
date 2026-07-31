(function () {
    const errorBox = document.getElementById('ldap-error');
    if (!errorBox) return;
    const successBox = document.getElementById('ldap-success');

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
            enabled: document.getElementById('ldap-enabled').checked,
            url: document.getElementById('ldap-url').value.trim(),
            bindDN: document.getElementById('ldap-bind-dn').value.trim(),
            bindPassword: document.getElementById('ldap-bind-password').value,
            searchBase: document.getElementById('ldap-search-base').value.trim(),
            searchFilter: document.getElementById('ldap-search-filter').value.trim()
        };
    }

    function applySettings(cfg) {
        document.getElementById('ldap-enabled').checked = !!cfg.enabled;
        document.getElementById('ldap-url').value = cfg.url || '';
        document.getElementById('ldap-bind-dn').value = cfg.bindDN || '';
        document.getElementById('ldap-bind-password').value = '';
        document.getElementById('ldap-bind-password-hint').hidden = !cfg.hasBindPassword;
        document.getElementById('ldap-search-base').value = cfg.searchBase || '';
        document.getElementById('ldap-search-filter').value = cfg.searchFilter || '';
    }

    async function load() {
        try {
            const cfg = await window.BWApi.apiFetch('/api/admin/settings/ldap');
            applySettings(cfg);
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('save-ldap-btn').addEventListener('click', async () => {
        try {
            const cfg = await window.BWApi.apiFetch('/api/admin/settings/ldap', { method: 'PUT', body: readForm() });
            applySettings(cfg);
            showSuccess('LDAP settings saved.');
        } catch (err) {
            showError(err);
        }
    });

    document.getElementById('test-ldap-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('ldap-test-status');
        statusEl.textContent = 'Testing…';
        try {
            const result = await window.BWApi.apiFetch('/api/admin/settings/ldap/test', { method: 'POST', body: readForm() });
            statusEl.textContent = result.ok ? '✓ Connected and bound successfully.' : `✗ ${result.message || 'Connection failed'}`;
        } catch (err) {
            statusEl.textContent = `✗ ${err.message || 'Connection failed'}`;
        }
    });

    document.getElementById('reset-ldap-btn').addEventListener('click', async () => {
        if (!confirm('Disable LDAP and clear the saved configuration?')) return;
        try {
            const cfg = await window.BWApi.apiFetch('/api/admin/settings/ldap', { method: 'DELETE' });
            applySettings(cfg);
            document.getElementById('ldap-test-status').textContent = '';
            showSuccess('LDAP settings cleared.');
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
