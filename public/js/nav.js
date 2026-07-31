(function () {
    const form = document.getElementById('logout-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
            await window.BWApi.apiFetch('/api/auth/logout', { method: 'POST' });
        } catch (err) {
            // Log out client-side regardless — worst case the server session
            // lingers until it expires on its own (see middleware/session.js).
        }
        window.location.href = '/';
    });
})();
