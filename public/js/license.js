(function () {
    const form = document.getElementById('license-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const errorBox = document.getElementById('license-error');
        errorBox.hidden = true;
        const key = document.getElementById('key').value.trim();

        try {
            await window.BWApi.apiFetch('/api/license/activate', { method: 'POST', body: { key } });
            window.location.href = '/';
        } catch (err) {
            errorBox.textContent = err.message || 'Activation failed';
            errorBox.hidden = false;
        }
    });
})();
