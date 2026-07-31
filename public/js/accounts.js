(function () {
    const tbody = document.getElementById('accounts-tbody');
    if (!tbody) return;
    const errorBox = document.getElementById('accounts-error');
    const form = document.getElementById('account-form');
    let editingId = null;

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function accountRow(account) {
        const tr = document.createElement('tr');
        const balanceClass = account.balanceCents < 0 ? 'money-negative' : 'money-positive';
        tr.innerHTML = `
            <td><a href="/accounts/${account.id}" class="link-plain">${account.name}${account.closed ? ' (closed)' : ''}</a></td>
            <td style="text-transform:capitalize;">${account.type}</td>
            <td class="money ${balanceClass}">${window.BWMoney.formatCents(account.balanceCents)}</td>
            <td>${account.onBudget ? 'Yes' : 'No'}</td>
            <td class="row-actions">
                <button type="button" class="btn btn-secondary btn-sm icon-btn" data-edit title="Edit">✎</button>
                <button type="button" class="btn btn-danger btn-sm icon-btn" data-delete title="Delete">🗑</button>
            </td>
        `;
        tr.querySelector('[data-edit]').addEventListener('click', () => startEdit(account));
        tr.querySelector('[data-delete]').addEventListener('click', () => openDeleteModal(account));
        return tr;
    }

    async function load() {
        try {
            const { accounts } = await window.BWApi.apiFetch('/api/accounts');
            tbody.innerHTML = '';
            if (accounts.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No accounts yet — add one above.</td></tr>';
                return;
            }
            // Already alphabetical from the server (services/database/accounts.js
            // sorts by name) — sorted again here defensively in case the list
            // ever gets assembled/merged client-side some other way.
            accounts.sort((a, b) => a.name.localeCompare(b.name)).forEach(a => tbody.appendChild(accountRow(a)));
        } catch (err) {
            showError(err);
        }
    }

    function startEdit(account) {
        editingId = account.id;
        document.getElementById('account-form-title').textContent = `Edit ${account.name}`;
        document.getElementById('acct-name').value = account.name;
        document.getElementById('acct-type').value = account.type;
        document.getElementById('acct-balance').value = (account.startingBalanceCents / 100).toFixed(2);
        document.getElementById('acct-balance-hint').hidden = false;
        document.getElementById('acct-on-budget').checked = account.onBudget;
        document.getElementById('acct-closed-group').hidden = false;
        document.getElementById('acct-closed').checked = account.closed;
        form.hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function resetForm() {
        editingId = null;
        document.getElementById('account-form-title').textContent = 'New account';
        document.getElementById('acct-name').value = '';
        document.getElementById('acct-type').value = 'checking';
        document.getElementById('acct-balance').value = '0';
        document.getElementById('acct-balance-hint').hidden = true;
        document.getElementById('acct-on-budget').checked = true;
        document.getElementById('acct-closed-group').hidden = true;
        document.getElementById('acct-closed').checked = false;
        form.hidden = true;
    }

    document.getElementById('new-account-btn').addEventListener('click', () => {
        if (!form.hidden && !editingId) { resetForm(); return; }
        resetForm();
        form.hidden = false;
    });
    document.getElementById('cancel-account-btn').addEventListener('click', resetForm);

    document.getElementById('save-account-btn').addEventListener('click', async () => {
        const name = document.getElementById('acct-name').value.trim();
        if (!name) return;
        const body = {
            name,
            type: document.getElementById('acct-type').value,
            startingBalanceCents: window.BWMoney.toCents(document.getElementById('acct-balance').value || 0),
            onBudget: document.getElementById('acct-on-budget').checked
        };
        if (editingId) body.closed = document.getElementById('acct-closed').checked;

        try {
            if (editingId) {
                await window.BWApi.apiFetch(`/api/accounts/${editingId}`, { method: 'PUT', body });
            } else {
                await window.BWApi.apiFetch('/api/accounts', { method: 'POST', body });
            }
            resetForm();
            load();
        } catch (err) {
            showError(err);
        }
    });

    // ── Delete confirmation — requires typing the account's exact name,
    // since deleting one is permanent (and blocked server-side anyway if it
    // still has transactions — see the 409 handling below).
    let pendingDeleteAccount = null;
    const overlay = document.getElementById('delete-account-overlay');
    const confirmInput = document.getElementById('delete-account-confirm-input');
    const confirmBtn = document.getElementById('delete-account-confirm-btn');

    function openDeleteModal(account) {
        pendingDeleteAccount = account;
        document.getElementById('delete-account-warning').textContent =
            `You are about to permanently delete "${account.name}".`;
        document.getElementById('delete-account-name-hint').textContent = account.name;
        confirmInput.value = '';
        confirmBtn.disabled = true;
        overlay.hidden = false;
        confirmInput.focus();
    }

    function closeDeleteModal() {
        pendingDeleteAccount = null;
        overlay.hidden = true;
    }

    confirmInput.addEventListener('input', () => {
        confirmBtn.disabled = !pendingDeleteAccount || confirmInput.value !== pendingDeleteAccount.name;
    });

    document.getElementById('delete-account-cancel-btn').addEventListener('click', closeDeleteModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDeleteModal();
    });

    confirmBtn.addEventListener('click', async () => {
        if (!pendingDeleteAccount || confirmInput.value !== pendingDeleteAccount.name) return;
        try {
            await window.BWApi.apiFetch(`/api/accounts/${pendingDeleteAccount.id}`, { method: 'DELETE' });
            closeDeleteModal();
            load();
        } catch (err) {
            document.getElementById('delete-account-warning').textContent = err.message || 'Could not delete this account.';
        }
    });

    load();
})();
