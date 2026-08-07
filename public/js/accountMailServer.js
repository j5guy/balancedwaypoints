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

    function applySmtp(account) {
        const smtp = account.smtp || {};
        document.getElementById('smtp-host').value = smtp.host || '';
        document.getElementById('smtp-port').value = smtp.port || '';
        document.getElementById('smtp-secure').checked = !!smtp.secure;
        document.getElementById('smtp-user').value = smtp.user || '';
        document.getElementById('smtp-from').value = smtp.from || '';
        document.getElementById('smtp-pass').value = '';
        document.getElementById('smtp-pass-hint').hidden = !smtp.hasPassword;
    }

    function readSmtpForm() {
        return {
            host: document.getElementById('smtp-host').value.trim(),
            port: document.getElementById('smtp-port').value,
            secure: document.getElementById('smtp-secure').checked,
            user: document.getElementById('smtp-user').value.trim(),
            pass: document.getElementById('smtp-pass').value,
            from: document.getElementById('smtp-from').value.trim()
        };
    }

    async function load() {
        try {
            const account = await window.BWApi.apiFetch('/api/account');
            applySmtp(account);
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('save-smtp-btn').addEventListener('click', async () => {
        try {
            const account = await window.BWApi.apiFetch('/api/account/smtp', { method: 'PUT', body: readSmtpForm() });
            applySmtp(account);
            showSuccess('Mail server settings saved.');
        } catch (err) {
            showError(err);
        }
    });

    document.getElementById('test-smtp-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('smtp-test-status');
        statusEl.textContent = 'Testing…';
        try {
            const result = await window.BWApi.apiFetch('/api/account/smtp/test', { method: 'POST', body: readSmtpForm() });
            statusEl.textContent = result.ok ? '✓ Connected successfully.' : `✗ ${result.message || 'Connection failed'}`;
        } catch (err) {
            statusEl.textContent = `✗ ${err.message || 'Connection failed'}`;
        }
    });

    document.getElementById('clear-smtp-btn').addEventListener('click', async () => {
        if (!confirm('Clear your saved mail server settings?')) return;
        try {
            const account = await window.BWApi.apiFetch('/api/account/smtp', { method: 'DELETE' });
            applySmtp(account);
            document.getElementById('smtp-test-status').textContent = '';
            showSuccess('Mail server settings cleared.');
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
