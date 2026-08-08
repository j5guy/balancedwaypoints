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
                <button type="button" class="btn btn-secondary btn-sm icon-btn" data-share title="Share">🔗</button>
                <button type="button" class="btn btn-secondary btn-sm icon-btn" data-edit title="Edit">✎</button>
                <button type="button" class="btn btn-danger btn-sm icon-btn" data-delete title="Delete">🗑</button>
            </td>
        `;
        tr.querySelector('[data-edit]').addEventListener('click', () => startEdit(account));
        tr.querySelector('[data-delete]').addEventListener('click', () => openDeleteModal(account));
        tr.querySelector('[data-share]').addEventListener('click', () => openShareModal(account));
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

    // ── "Shared with me" — a distinct, non-owned list; no edit/delete/share
    // actions since a collaborator can't manage the account itself.
    async function loadSharedWithMe() {
        const section = document.getElementById('shared-with-me-section');
        const sharedTbody = document.getElementById('shared-with-me-tbody');
        try {
            const { accounts } = await window.BWApi.apiFetch('/api/accounts/shared-with-me');
            if (accounts.length === 0) {
                section.hidden = true;
                return;
            }
            section.hidden = false;
            sharedTbody.innerHTML = '';
            accounts.forEach((a) => {
                const balanceClass = a.balanceCents < 0 ? 'money-negative' : 'money-positive';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><a href="/accounts/${a.id}" class="link-plain">${a.name}</a></td>
                    <td>${a.ownerName}</td>
                    <td style="text-transform:capitalize;">${a.role === 'readwrite' ? 'Read-write' : 'Read-only'}</td>
                    <td class="money ${balanceClass}">${window.BWMoney.formatCents(a.balanceCents)}</td>
                    <td></td>
                `;
                sharedTbody.appendChild(tr);
            });
        } catch (err) {
            section.hidden = true;
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
        document.getElementById('acct-forecast-threshold').value = ((account.forecastThresholdCents || 0) / 100).toFixed(2);
        document.getElementById('acct-forecast-color').value = account.forecastThresholdColor || '#B5433A';
        document.getElementById('acct-forecast-mid-threshold').value = account.forecastThresholdMidCents != null ? (account.forecastThresholdMidCents / 100).toFixed(2) : '';
        document.getElementById('acct-forecast-mid-color').value = account.forecastThresholdMidColor || '#E3A93A';
        document.getElementById('acct-forecast-upper-threshold').value = account.forecastThresholdUpperCents != null ? (account.forecastThresholdUpperCents / 100).toFixed(2) : '';
        document.getElementById('acct-forecast-upper-color').value = account.forecastThresholdUpperColor || '#2E8B57';
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
        document.getElementById('acct-forecast-threshold').value = '0';
        document.getElementById('acct-forecast-color').value = '#B5433A';
        document.getElementById('acct-forecast-mid-threshold').value = '';
        document.getElementById('acct-forecast-mid-color').value = '#E3A93A';
        document.getElementById('acct-forecast-upper-threshold').value = '';
        document.getElementById('acct-forecast-upper-color').value = '#2E8B57';
        form.hidden = true;
    }

    document.getElementById('new-account-btn').addEventListener('click', () => {
        if (!form.hidden && !editingId) { resetForm(); return; }
        resetForm();
        form.hidden = false;
    });
    document.getElementById('cancel-account-btn').addEventListener('click', resetForm);

    // Mid/upper threshold amounts are optional — a blank field means that
    // band is disabled (see models/account.js), distinct from an explicit 0.
    function optionalCents(inputId) {
        const raw = document.getElementById(inputId).value.trim();
        return raw === '' ? null : window.BWMoney.toCents(raw);
    }

    document.getElementById('save-account-btn').addEventListener('click', async () => {
        const name = document.getElementById('acct-name').value.trim();
        if (!name) return;
        const body = {
            name,
            type: document.getElementById('acct-type').value,
            startingBalanceCents: window.BWMoney.toCents(document.getElementById('acct-balance').value || 0),
            forecastThresholdCents: window.BWMoney.toCents(document.getElementById('acct-forecast-threshold').value || 0),
            forecastThresholdColor: document.getElementById('acct-forecast-color').value,
            forecastThresholdMidCents: optionalCents('acct-forecast-mid-threshold'),
            forecastThresholdMidColor: document.getElementById('acct-forecast-mid-color').value,
            forecastThresholdUpperCents: optionalCents('acct-forecast-upper-threshold'),
            forecastThresholdUpperColor: document.getElementById('acct-forecast-upper-color').value,
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
    const forceSection = document.getElementById('delete-account-force-section');
    const forceBtn = document.getElementById('delete-account-force-btn');

    function openDeleteModal(account) {
        pendingDeleteAccount = account;
        document.getElementById('delete-account-warning').textContent =
            `You are about to permanently delete "${account.name}".`;
        document.getElementById('delete-account-name-hint').textContent = account.name;
        confirmInput.value = '';
        confirmBtn.disabled = true;
        // Force-delete is only ever offered for accounts already marked
        // closed — matches the server-side check in
        // services/database/accounts.js's forceRemove.
        forceSection.hidden = !account.closed;
        forceBtn.disabled = true;
        overlay.hidden = false;
        confirmInput.focus();
    }

    function closeDeleteModal() {
        pendingDeleteAccount = null;
        overlay.hidden = true;
    }

    confirmInput.addEventListener('input', () => {
        const matches = !!pendingDeleteAccount && confirmInput.value === pendingDeleteAccount.name;
        confirmBtn.disabled = !matches;
        forceBtn.disabled = !matches;
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

    forceBtn.addEventListener('click', async () => {
        if (!pendingDeleteAccount || confirmInput.value !== pendingDeleteAccount.name) return;
        try {
            await window.BWApi.apiFetch(`/api/accounts/${pendingDeleteAccount.id}/force`, { method: 'DELETE' });
            closeDeleteModal();
            load();
        } catch (err) {
            document.getElementById('delete-account-warning').textContent = err.message || 'Could not force-delete this account.';
        }
    });

    // ── Sharing — owner-only. Mirrors the delete modal's overlay pattern;
    // the share list re-fetches from the server after every add/remove/
    // permission change rather than patching the DOM in place, since this
    // modal is opened rarely enough that the extra round trip doesn't matter.
    let sharingAccount = null;
    const shareOverlay = document.getElementById('share-account-overlay');
    const shareError = document.getElementById('share-account-error');
    const shareListTbody = document.getElementById('share-list-tbody');
    const shareAddEmail = document.getElementById('share-add-email');
    const shareAddPermission = document.getElementById('share-add-permission');

    function showShareError(err) {
        shareError.textContent = err.message || 'Something went wrong';
        shareError.hidden = false;
    }

    function shareRow(share) {
        const tr = document.createElement('tr');
        const person = share.sharedWith ? (share.sharedWith.displayName || share.sharedWith.email) : 'Unknown';
        tr.innerHTML = `
            <td>${person}</td>
            <td>
                <select data-permission>
                    <option value="readonly"${share.permission === 'readonly' ? ' selected' : ''}>Read-only</option>
                    <option value="readwrite"${share.permission === 'readwrite' ? ' selected' : ''}>Read-write</option>
                </select>
            </td>
            <td class="row-actions"><button type="button" class="btn btn-danger btn-sm icon-btn" data-remove title="Remove">🗑</button></td>
        `;
        tr.querySelector('[data-permission]').addEventListener('change', async (e) => {
            try {
                await window.BWApi.apiFetch(`/api/accounts/${sharingAccount.id}/shares/${share.id}`, { method: 'PUT', body: { permission: e.target.value } });
            } catch (err) {
                showShareError(err);
                loadShares();
            }
        });
        tr.querySelector('[data-remove]').addEventListener('click', async () => {
            try {
                await window.BWApi.apiFetch(`/api/accounts/${sharingAccount.id}/shares/${share.id}`, { method: 'DELETE' });
                loadShares();
            } catch (err) {
                showShareError(err);
            }
        });
        return tr;
    }

    async function loadShares() {
        try {
            const { shares } = await window.BWApi.apiFetch(`/api/accounts/${sharingAccount.id}/shares`);
            shareListTbody.innerHTML = '';
            if (shares.length === 0) {
                shareListTbody.innerHTML = '<tr><td colspan="3" class="empty-state">Not shared with anyone yet.</td></tr>';
                return;
            }
            shares.forEach(s => shareListTbody.appendChild(shareRow(s)));
        } catch (err) {
            showShareError(err);
        }
    }

    function openShareModal(account) {
        sharingAccount = account;
        document.getElementById('share-account-name').textContent = account.name;
        shareError.hidden = true;
        shareAddEmail.value = '';
        shareAddPermission.value = 'readonly';
        shareOverlay.hidden = false;
        loadShares();
    }

    function closeShareModal() {
        sharingAccount = null;
        shareOverlay.hidden = true;
        load();
    }

    document.getElementById('share-close-btn').addEventListener('click', closeShareModal);
    shareOverlay.addEventListener('click', (e) => {
        if (e.target === shareOverlay) closeShareModal();
    });

    document.getElementById('share-add-btn').addEventListener('click', async () => {
        const email = shareAddEmail.value.trim();
        if (!email) return;
        shareError.hidden = true;
        try {
            await window.BWApi.apiFetch(`/api/accounts/${sharingAccount.id}/shares`, {
                method: 'POST',
                body: { email, permission: shareAddPermission.value }
            });
            shareAddEmail.value = '';
            loadShares();
        } catch (err) {
            showShareError(err);
        }
    });

    // Deep-link from the register page's "Account settings" button
    // (views/accounts/show.ejs), same ?account=-style pattern as the
    // Import link — opens straight into edit mode for that account instead
    // of making the user find it in the table. Fetched directly by id
    // rather than waiting on load()'s list, and the query param is
    // stripped afterward so a later refresh of this page doesn't re-open it.
    async function openEditFromQueryParam() {
        const params = new URLSearchParams(window.location.search);
        const editId = params.get('edit');
        if (!editId) return;
        history.replaceState(null, '', window.location.pathname);
        try {
            const account = await window.BWApi.apiFetch(`/api/accounts/${editId}`);
            startEdit(account);
        } catch (err) {
            showError(err);
        }
    }

    load();
    loadSharedWithMe();
    openEditFromQueryParam();
})();
