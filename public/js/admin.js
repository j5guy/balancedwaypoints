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
            <td class="row-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-edit>Edit</button>
                <button type="button" class="btn btn-danger btn-sm" data-delete>Delete</button>
            </td>
        `;
        tr.querySelector('[data-admin-toggle]').addEventListener('change', async (e) => {
            try {
                await window.BWApi.apiFetch(`/api/admin/users/${user.id}/admin`, { method: 'PUT', body: { isAdmin: e.target.checked } });
            } catch (err) {
                e.target.checked = !e.target.checked;
                showError(err);
            }
        });
        tr.querySelector('[data-edit]').addEventListener('click', () => openEditModal(user, tr));
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

    // ── Edit user modal ───────────────────────────────────────────
    const editOverlay = document.getElementById('edit-user-overlay');
    const editErrorBox = document.getElementById('edit-user-error');
    const editEmailInput = document.getElementById('edit-user-email');
    const editDisplayNameInput = document.getElementById('edit-user-display-name');
    const editLdapHint = document.getElementById('edit-user-ldap-hint');
    let editingUser = null;
    let editingRow = null;

    function openEditModal(user, tr) {
        editingUser = user;
        editingRow = tr;
        editErrorBox.hidden = true;
        editEmailInput.value = user.email;
        editDisplayNameInput.value = user.displayName || '';
        editLdapHint.hidden = user.authSource !== 'ldap';
        editOverlay.hidden = false;
        editEmailInput.focus();
    }

    function closeEditModal() {
        editOverlay.hidden = true;
        editingUser = null;
        editingRow = null;
    }

    document.getElementById('cancel-edit-user-btn').addEventListener('click', closeEditModal);
    editOverlay.addEventListener('click', (e) => {
        if (e.target === editOverlay) closeEditModal();
    });

    document.getElementById('save-edit-user-btn').addEventListener('click', async () => {
        if (!editingUser) return;
        try {
            const updated = await window.BWApi.apiFetch(`/api/admin/users/${editingUser.id}`, {
                method: 'PUT',
                body: { email: editEmailInput.value.trim(), displayName: editDisplayNameInput.value.trim() }
            });
            editingRow.replaceWith(row(updated));
            closeEditModal();
        } catch (err) {
            editErrorBox.textContent = err.message || 'Something went wrong';
            editErrorBox.hidden = false;
        }
    });

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
