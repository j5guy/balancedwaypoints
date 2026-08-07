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

    async function load() {
        try {
            const account = await window.BWApi.apiFetch('/api/account');
            document.getElementById('notify-email').value = account.notifyEmail || '';
            document.getElementById('weekly-report-email').checked = account.weeklyReportEmail;
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

    load();
})();
