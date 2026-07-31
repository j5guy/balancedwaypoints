(function () {
    const errorBox = document.getElementById('account-error');
    if (!errorBox) return;
    const successBox = document.getElementById('account-success');

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

    function applyAccount(account) {
        document.getElementById('account-email').textContent = account.email;
        document.getElementById('account-auth-source').textContent = account.authSource === 'ldap' ? 'LDAP' : 'Local account';
        document.getElementById('notify-email').value = account.notifyEmail || '';
        document.getElementById('weekly-report-email').checked = account.weeklyReportEmail;

        document.getElementById('smtp-host').value = account.smtp.host || '';
        document.getElementById('smtp-port').value = account.smtp.port || '';
        document.getElementById('smtp-secure').checked = !!account.smtp.secure;
        document.getElementById('smtp-user').value = account.smtp.user || '';
        document.getElementById('smtp-from').value = account.smtp.from || '';
        document.getElementById('smtp-pass').value = '';
        document.getElementById('smtp-pass-hint').hidden = !account.smtp.hasPassword;
    }

    async function load() {
        try {
            const account = await window.BWApi.apiFetch('/api/account');
            applyAccount(account);
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('save-notifications-btn').addEventListener('click', async () => {
        try {
            // notifyEmail lives directly on the user doc (see models/user.js)
            // but is saved through /api/auth/preferences rather than the SMTP
            // endpoint, deliberately — so setting it never requires a valid
            // mail server to already be configured.
            await window.BWApi.apiFetch('/api/auth/preferences', {
                method: 'PUT',
                body: {
                    weeklyReportEmail: document.getElementById('weekly-report-email').checked,
                    notifyEmail: document.getElementById('notify-email').value.trim()
                }
            });
            showSuccess('Notification settings saved.');
        } catch (err) {
            showError(err);
        }
    });

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

    document.getElementById('save-smtp-btn').addEventListener('click', async () => {
        try {
            const account = await window.BWApi.apiFetch('/api/account/smtp', { method: 'PUT', body: readSmtpForm() });
            applyAccount(account);
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
            applyAccount(account);
            document.getElementById('smtp-test-status').textContent = '';
            showSuccess('Mail server settings cleared.');
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
