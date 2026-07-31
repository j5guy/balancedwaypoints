(function () {
    const tbody = document.getElementById('users-tbody');
    const errorBox = document.getElementById('users-error');
    if (!tbody) return;

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function row(user) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${user.email}</td>
            <td>${user.displayName || ''}</td>
            <td><input type="checkbox" data-admin-toggle ${user.isAdmin ? 'checked' : ''}></td>
            <td>${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</td>
            <td class="row-actions"><button type="button" class="btn btn-danger btn-sm" data-delete>Delete</button></td>
        `;
        tr.querySelector('[data-admin-toggle]').addEventListener('change', async (e) => {
            try {
                await window.BWApi.apiFetch(`/api/admin/users/${user.id}/admin`, { method: 'PUT', body: { isAdmin: e.target.checked } });
            } catch (err) {
                e.target.checked = !e.target.checked;
                showError(err);
            }
        });
        tr.querySelector('[data-delete]').addEventListener('click', async () => {
            if (!confirm(`Delete ${user.email}?`)) return;
            try {
                await window.BWApi.apiFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
                tr.remove();
            } catch (err) {
                showError(err);
            }
        });
        return tr;
    }

    async function load() {
        try {
            const { users } = await window.BWApi.apiFetch('/api/admin/users');
            tbody.innerHTML = '';
            users.forEach(u => tbody.appendChild(row(u)));
        } catch (err) {
            showError(err);
        }
    }

    load();
})();
