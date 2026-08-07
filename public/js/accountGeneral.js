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
            document.getElementById('home-dashboard').value = account.homeDashboard || 'budget';
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('save-general-btn').addEventListener('click', async () => {
        try {
            await window.BWApi.apiFetch('/api/auth/preferences', {
                method: 'PUT',
                body: { homeDashboard: document.getElementById('home-dashboard').value }
            });
            showSuccess('General settings saved.');
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
