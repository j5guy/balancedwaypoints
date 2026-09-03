(function () {
    const form = document.getElementById('admin-license-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const errorBox = document.getElementById('license-error');
        errorBox.hidden = true;
        const key = document.getElementById('admin-license-key').value.trim();

        try {
            await window.BWApi.apiFetch('/api/license/activate', { method: 'POST', body: { key } });
            window.location.reload();
        } catch (err) {
            errorBox.textContent = err.message || 'Activation failed';
            errorBox.hidden = false;
        }
    });
})();
