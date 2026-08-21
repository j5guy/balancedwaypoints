(function () {
    const tbody = document.getElementById('accounts-tbody');
    if (!tbody) return;
    const errorBox = document.getElementById('accounts-error');
    const form = document.getElementById('account-form');
    let editingId = null;
    let accountGroups = [];
    let currentAccounts = [];

    // Which groups are collapsed, persisted across visits (localStorage,
    // not a server preference — purely a per-browser display convenience,
    // same reasoning as public/js/theme.js's stored choice). The pseudo-
    // group "ungrouped" (accounts with no group set) can collapse too.
    const COLLAPSE_KEY = 'bw-account-groups-collapsed';
    function loadCollapsedSet() {
        try {
            return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'));
        } catch (err) {
            return new Set();
        }
    }
    let collapsedGroups = loadCollapsedSet();
    function saveCollapsedSet() {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsedGroups]));
    }

    // Live column filters — narrows the rendered table with no re-fetch,
    // same pattern as the register's own filter row (public/js/register.js).
    let filterState = { name: '', type: '', balance: '', onbudget: '' };
    function isFiltering() {
        return Object.values(filterState).some(v => v);
    }
    function matchesFilters(account) {
        const f = filterState;
        if (f.name && !account.name.toLowerCase().includes(f.name)) return false;
        if (f.type && !account.type.toLowerCase().includes(f.type)) return false;
        if (f.balance && !(account.balanceCents / 100).toFixed(2).includes(f.balance)) return false;
        if (f.onbudget && !(account.onBudget ? 'yes' : 'no').includes(f.onbudget)) return false;
        return true;
    }

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function accountRow(account) {
        const tr = document.createElement('tr');
        const balanceClass = account.balanceCents < 0 ? 'money-negative' : 'money-positive';
        const syncBadge = account.simplefinAccountId
            ? ' <span class="badge" title="Synced via SimpleFIN — new transactions import automatically">🔄</span>'
            : '';
        tr.innerHTML = `
            <td><a href="/accounts/${account.id}" class="link-plain">${account.name}${account.closed ? ' (closed)' : ''}</a>${syncBadge}</td>
            <td style="text-transform:capitalize;">${account.type}</td>
            <td class="money ${balanceClass}">${window.BWMoney.formatCents(account.balanceCents)}</td>
            <td>${account.onBudget ? 'Yes' : 'No'}</td>
            <td class="row-actions">
                ${account.simplefinAccountId ? '<button type="button" class="btn btn-secondary btn-sm icon-btn" data-unlink-sync title="Stop syncing this account">🔌</button>' : ''}
                <button type="button" class="btn btn-secondary btn-sm icon-btn" data-share title="Share">🔗</button>
                <button type="button" class="btn btn-secondary btn-sm icon-btn" data-edit title="Edit">✎</button>
                <button type="button" class="btn btn-danger btn-sm icon-btn" data-delete title="Delete">🗑</button>
            </td>
        `;
        tr.querySelector('[data-edit]').addEventListener('click', () => startEdit(account));
        tr.querySelector('[data-delete]').addEventListener('click', () => openDeleteModal(account));
        tr.querySelector('[data-share]').addEventListener('click', () => openShareModal(account));
        const unlinkBtn = tr.querySelector('[data-unlink-sync]');
        if (unlinkBtn) unlinkBtn.addEventListener('click', () => unlinkSync(account));
        return tr;
    }

    // One header row per group (plus a trailing "Ungrouped" pseudo-group for
    // accounts with no group set) — click anywhere on it to expand/collapse.
    // Skipped entirely (flat list, no headers) when no group exists yet and
    // nothing is assigned to one, so accounts that never touch this feature
    // see no change from before it existed.
    function groupHeaderRow(group, count) {
        const tr = document.createElement('tr');
        tr.className = 'account-group-header';
        const collapsed = collapsedGroups.has(group.id);
        const isReal = group.id !== 'ungrouped';
        tr.innerHTML = `
            <td colspan="5" style="cursor:pointer;background:var(--bg-hover);font-weight:600;">
                <span data-toggle>${collapsed ? '▸' : '▾'}</span> ${group.name} <span class="muted">(${count})</span>
                ${isReal ? `
                    <button type="button" class="icon-btn" data-rename-group title="Rename group" style="border:none;background:none;cursor:pointer;float:right;">✎</button>
                    <button type="button" class="icon-btn" data-delete-group title="Delete group" style="border:none;background:none;cursor:pointer;float:right;">🗑</button>
                ` : ''}
            </td>
        `;
        tr.addEventListener('click', (e) => {
            if (e.target.closest('[data-rename-group],[data-delete-group]')) return;
            if (collapsedGroups.has(group.id)) collapsedGroups.delete(group.id);
            else collapsedGroups.add(group.id);
            saveCollapsedSet();
            renderAccounts();
        });
        if (isReal) {
            tr.querySelector('[data-rename-group]').addEventListener('click', () => renameGroup(group));
            tr.querySelector('[data-delete-group]').addEventListener('click', () => deleteGroup(group));
        }
        return tr;
    }

    async function renameGroup(group) {
        const name = prompt('Rename group:', group.name);
        if (!name || !name.trim() || name.trim() === group.name) return;
        try {
            await window.BWApi.apiFetch(`/api/account-groups/${group.id}`, { method: 'PUT', body: { name: name.trim() } });
            await loadGroups();
            renderAccounts();
        } catch (err) {
            showError(err);
        }
    }

    // No confirmation modal (unlike deleting an account) — deleting a group
    // just un-groups its accounts server-side (see
    // services/database/accountGroups.js's remove), nothing is lost.
    async function deleteGroup(group) {
        if (!confirm(`Delete the group "${group.name}"? Its accounts stay — they just become ungrouped.`)) return;
        try {
            await window.BWApi.apiFetch(`/api/account-groups/${group.id}`, { method: 'DELETE' });
            collapsedGroups.delete(group.id);
            saveCollapsedSet();
            await loadGroups();
            load();
        } catch (err) {
            showError(err);
        }
    }

    // Renders currentAccounts (already loaded from the server) into
    // #accounts-tbody, applying the live column filters and, once at least
    // one group exists or an account is assigned to one, splitting into
    // collapsible per-group sections with a trailing "Ungrouped" section.
    function renderAccounts() {
        tbody.innerHTML = '';
        const visible = currentAccounts.filter(matchesFilters);

        if (currentAccounts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No accounts yet — add one above.</td></tr>';
            return;
        }
        if (visible.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No accounts match these filters.</td></tr>';
            return;
        }

        const useGroups = accountGroups.length > 0 || currentAccounts.some(a => a.group);
        if (!useGroups) {
            visible.sort((a, b) => a.name.localeCompare(b.name)).forEach(a => tbody.appendChild(accountRow(a)));
            return;
        }

        const byGroupId = new Map(visible.map(a => [a, a.group || 'ungrouped']));
        const sections = accountGroups.map(g => ({ group: g, accounts: [] }));
        const sectionById = new Map(sections.map(s => [s.group.id, s]));
        const ungrouped = { group: { id: 'ungrouped', name: 'Ungrouped' }, accounts: [] };

        visible.forEach((a) => {
            const gid = byGroupId.get(a);
            const section = sectionById.get(gid);
            (section || ungrouped).accounts.push(a);
        });

        [...sections, ungrouped].forEach(({ group, accounts }) => {
            // An empty real group still gets a header (so it doesn't look
            // like it vanished) unless a filter is what emptied it — the
            // "Ungrouped" pseudo-group only ever shows when it has rows.
            if (accounts.length === 0 && (isFiltering() || group.id === 'ungrouped')) return;
            tbody.appendChild(groupHeaderRow(group, accounts.length));
            if (!collapsedGroups.has(group.id)) {
                accounts.sort((a, b) => a.name.localeCompare(b.name)).forEach(a => tbody.appendChild(accountRow(a)));
            }
        });
    }

    // Manage > Bank Sync (public/js/accountBankSync.js) is where a sync
    // connection/link first gets set up — this is just the quick "stop
    // syncing this one account" escape hatch from the Accounts table itself.
    async function unlinkSync(account) {
        if (!confirm(`Stop syncing "${account.name}"? Its transaction history stays — it just goes back to manual entry.`)) return;
        try {
            await window.BWApi.apiFetch(`/api/accounts/${account.id}/simplefin/unlink`, { method: 'POST' });
            load();
        } catch (err) {
            showError(err);
        }
    }

    async function load() {
        try {
            const { accounts } = await window.BWApi.apiFetch('/api/accounts');
            currentAccounts = accounts;
            renderAccounts();
        } catch (err) {
            showError(err);
        }
    }

    async function loadGroups() {
        try {
            const { accountGroups: groups } = await window.BWApi.apiFetch('/api/account-groups');
            accountGroups = groups;
            const select = document.getElementById('acct-group');
            const current = select.value;
            select.innerHTML = '<option value="">— no group —</option>' +
                accountGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
            select.value = current;
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('acct-new-group-btn').addEventListener('click', async () => {
        const name = prompt('New group name:');
        if (!name || !name.trim()) return;
        try {
            const group = await window.BWApi.apiFetch('/api/account-groups', { method: 'POST', body: { name: name.trim() } });
            await loadGroups();
            document.getElementById('acct-group').value = group.id;
        } catch (err) {
            showError(err);
        }
    });

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
        document.getElementById('acct-forecast-threshold').value = account.forecastThresholdCents != null ? (account.forecastThresholdCents / 100).toFixed(2) : '';
        document.getElementById('acct-forecast-color').value = account.forecastThresholdColor || '#B5433A';
        document.getElementById('acct-group').value = account.group || '';
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
        document.getElementById('acct-forecast-threshold').value = '';
        document.getElementById('acct-forecast-color').value = '#B5433A';
        document.getElementById('acct-group').value = '';
        form.hidden = true;
    }

    document.getElementById('new-account-btn').addEventListener('click', () => {
        if (!form.hidden && !editingId) { resetForm(); return; }
        resetForm();
        form.hidden = false;
    });
    document.getElementById('cancel-account-btn').addEventListener('click', resetForm);

    // A blank warning threshold means the register's Forecast chart won't
    // show one at all, distinct from an explicit $0.
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
            forecastThresholdCents: optionalCents('acct-forecast-threshold'),
            forecastThresholdColor: document.getElementById('acct-forecast-color').value,
            onBudget: document.getElementById('acct-on-budget').checked,
            group: document.getElementById('acct-group').value || null
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

    // Account names created from a SimpleFIN link come straight from the
    // bank's own label (see public/js/accountBankSync.js), which can carry
    // a non-breaking space or other whitespace that's visually identical to
    // a regular space but fails a strict ===. Collapsing all whitespace
    // (including NBSP) before comparing means what the user sees is what
    // gets matched, not the raw bytes underneath.
    function normalizeForCompare(s) {
        return String(s || '').replace(/ /g, ' ').trim();
    }
    function inputMatchesPendingAccount() {
        return !!pendingDeleteAccount && normalizeForCompare(confirmInput.value) === normalizeForCompare(pendingDeleteAccount.name);
    }

    confirmInput.addEventListener('input', () => {
        const matches = inputMatchesPendingAccount();
        confirmBtn.disabled = !matches;
        forceBtn.disabled = !matches;
    });

    document.getElementById('delete-account-cancel-btn').addEventListener('click', closeDeleteModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDeleteModal();
    });

    confirmBtn.addEventListener('click', async () => {
        if (!inputMatchesPendingAccount()) return;
        try {
            await window.BWApi.apiFetch(`/api/accounts/${pendingDeleteAccount.id}`, { method: 'DELETE' });
            closeDeleteModal();
            load();
        } catch (err) {
            document.getElementById('delete-account-warning').textContent = err.message || 'Could not delete this account.';
        }
    });

    forceBtn.addEventListener('click', async () => {
        if (!inputMatchesPendingAccount()) return;
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

    // ── Live column filters — narrows #accounts-tbody as you type, no
    // re-fetch (see matchesFilters/renderAccounts above).
    const FILTER_FIELDS = ['name', 'type', 'balance', 'onbudget'];
    FILTER_FIELDS.forEach((field) => {
        document.getElementById(`filter-${field}`).addEventListener('input', (e) => {
            filterState[field] = e.target.value.trim().toLowerCase();
            renderAccounts();
        });
    });
    document.getElementById('filter-clear-btn').addEventListener('click', () => {
        FILTER_FIELDS.forEach((field) => {
            filterState[field] = '';
            document.getElementById(`filter-${field}`).value = '';
        });
        renderAccounts();
    });

    // loadGroups() before load()/openEditFromQueryParam() — both populate
    // #acct-group's selected value, which only sticks once its <option>s
    // from loadGroups() actually exist.
    (async () => {
        await loadGroups();
        load();
        loadSharedWithMe();
        openEditFromQueryParam();
    })();
})();
