(function () {
    const connectionsTbody = document.getElementById('sf-connections-tbody');
    if (!connectionsTbody) return;
    const errorBox = document.getElementById('account-error');
    const successBox = document.getElementById('account-success');
    const linkSection = document.getElementById('sf-link-section');
    const linkTbody = document.getElementById('sf-link-tbody');
    const linkLabel = document.getElementById('sf-link-connection-label');

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

    function fmtDate(iso) {
        if (!iso) return 'never';
        return new Date(iso).toLocaleString();
    }

    async function loadConnections() {
        try {
            const { connections } = await window.BWApi.apiFetch('/api/simplefin/connections');
            connectionsTbody.innerHTML = '';
            if (connections.length === 0) {
                connectionsTbody.innerHTML = '<tr><td colspan="5" class="empty-state">No bank connections yet — connect one above.</td></tr>';
                return;
            }
            connections.forEach((c) => connectionsTbody.appendChild(connectionRow(c)));
        } catch (err) {
            showError(err);
        }
    }

    function connectionRow(connection) {
        const tr = document.createElement('tr');
        // One name per line rather than a single comma-joined run — a
        // connection with several linked accounts (e.g. checking + savings
        // + a credit card all under one bank login) was unreadable packed
        // into one line in this column's fixed width.
        const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const linkedNames = connection.linkedAccounts.length
            ? connection.linkedAccounts.map((a) => escapeHtml(a.name)).join('<br>')
            : '<span class="muted">none linked</span>';
        // lastSyncError doubles as a non-fatal warnings note on an
        // otherwise-'ok' sync (see services/simplefin/syncService.js) — e.g.
        // one linked account's transactions parsed fine while another's
        // didn't — so the tooltip surfaces it either way, not just on 'error'.
        const warningTitle = (connection.lastSyncError || '').replace(/"/g, '&quot;');
        const statusBadge = connection.lastSyncStatus === 'error'
            ? `<span class="badge" title="${warningTitle}">⚠ error</span>`
            : (connection.lastSyncStatus === 'ok'
                ? (connection.lastSyncError ? `<span class="badge" title="${warningTitle}">✓ ok (with warnings)</span>` : '<span class="badge">✓ ok</span>')
                : '<span class="muted">—</span>');
        tr.innerHTML = `
            <td>${connection.label}</td>
            <td>${linkedNames}</td>
            <td>${fmtDate(connection.lastSyncAt)}</td>
            <td>${statusBadge}</td>
            <td class="row-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-manage>Manage accounts</button>
                <button type="button" class="btn btn-secondary btn-sm" data-sync>Sync now</button>
                <button type="button" class="btn btn-danger btn-sm" data-disconnect>Disconnect</button>
            </td>
        `;
        tr.querySelector('[data-manage]').addEventListener('click', () => openLinkSection(connection));
        tr.querySelector('[data-sync]').addEventListener('click', () => syncNow(connection));
        tr.querySelector('[data-disconnect]').addEventListener('click', () => disconnect(connection));
        return tr;
    }

    async function syncNow(connection) {
        try {
            const result = await window.BWApi.apiFetch(`/api/simplefin/connections/${connection.id}/sync`, { method: 'POST' });
            showSuccess(`Synced "${connection.label}" — imported ${result.created} new transaction${result.created === 1 ? '' : 's'}.${result.warnings.length ? ' See below for warnings.' : ''}`);
            if (result.warnings.length) console.warn('SimpleFIN sync warnings:', result.warnings);
            loadConnections();
        } catch (err) {
            showError(err);
        }
    }

    async function disconnect(connection) {
        if (!confirm(`Disconnect "${connection.label}"? Linked accounts stop syncing (their transaction history stays) and this connection is removed.`)) return;
        try {
            await window.BWApi.apiFetch(`/api/simplefin/connections/${connection.id}`, { method: 'DELETE' });
            linkSection.hidden = true;
            showSuccess(`Disconnected "${connection.label}".`);
            loadConnections();
        } catch (err) {
            showError(err);
        }
    }

    // Shared by both the "just connected" flow (remoteAccounts passed in
    // directly from the connect response) and "Manage accounts" on an
    // existing connection (remoteAccounts re-fetched live, since a new
    // account may have appeared at the bridge since it was first set up).
    async function renderLinkSection(connection, remoteAccounts) {
        linkLabel.textContent = `— ${connection.label}`;
        linkTbody.innerHTML = '';

        let localAccounts = [];
        try {
            const { accounts } = await window.BWApi.apiFetch('/api/accounts');
            localAccounts = accounts;
        } catch (err) { /* linking to an existing account just won't be offered */ }

        const linkedByRemoteId = new Map((connection.linkedAccounts || []).map((a) => [a.simplefinAccountId, a]));

        remoteAccounts.forEach((remote) => {
            const already = linkedByRemoteId.get(remote.id);
            const tr = document.createElement('tr');
            const balance = remote.balanceCents != null ? window.BWMoney.formatCents(remote.balanceCents) : '—';
            const orgLabel = remote.org ? `${remote.org} — ${remote.name}` : remote.name;

            if (already) {
                tr.innerHTML = `
                    <td>${orgLabel}</td>
                    <td class="money">${balance}</td>
                    <td>Linked to <strong>${already.name}</strong></td>
                    <td><button type="button" class="btn btn-secondary btn-sm" data-unlink>Unlink</button></td>
                `;
                tr.querySelector('[data-unlink]').addEventListener('click', () => openUnlinkModal(already, connection, remoteAccounts));
                linkTbody.appendChild(tr);
                return;
            }

            const options = ['<option value="">Create new account: "' + remote.name + '"</option>', '<option value="__custom__">Create new account with a custom name…</option>']
                .concat(localAccounts.map((a) => `<option value="${a.id}">${a.name}</option>`));
            // Same Type/On budget choices as creating an account from scratch
            // on the Accounts page (views/accounts/index.ejs) — shown only
            // while a *new* account is what's about to be created, hidden
            // the moment an existing account is picked instead (its own
            // type/on-budget are already set and untouched by linking).
            tr.innerHTML = `
                <td>${orgLabel}</td>
                <td class="money">${balance}</td>
                <td>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <select data-target style="width:100%;">${options.join('')}</select>
                        <input type="text" data-custom-name placeholder="Account name" style="width:100%;" hidden>
                        <select data-new-type style="width:100%;">
                            <optgroup label="Accounts">
                                <option value="checking">Checking</option>
                                <option value="savings">Savings</option>
                                <option value="credit">Credit card</option>
                                <option value="cash">Cash</option>
                                <option value="loan">Loan</option>
                            </optgroup>
                            <optgroup label="Assets">
                                <option value="investment">Investment</option>
                                <option value="home">Home</option>
                                <option value="vehicle">Vehicle</option>
                            </optgroup>
                            <option value="other">Other</option>
                        </select>
                        <label class="checkbox-row" style="font-size:0.85rem;">
                            <input type="checkbox" data-new-on-budget checked>
                            On budget
                        </label>
                    </div>
                </td>
                <td><button type="button" class="btn btn-primary btn-sm" data-link>Link</button></td>
            `;
            const targetSelect = tr.querySelector('[data-target]');
            const customNameInput = tr.querySelector('[data-custom-name]');
            const newTypeSelect = tr.querySelector('[data-new-type]');
            const newOnBudgetCheckbox = tr.querySelector('[data-new-on-budget]');
            const newAccountFields = [newTypeSelect, newOnBudgetCheckbox.closest('label')];
            function syncFieldVisibility() {
                const isCustom = targetSelect.value === '__custom__';
                const isNew = !targetSelect.value || isCustom;
                customNameInput.hidden = !isCustom;
                if (isCustom) customNameInput.focus();
                newAccountFields.forEach((el) => { el.hidden = !isNew; });
            }
            targetSelect.addEventListener('change', syncFieldVisibility);
            syncFieldVisibility();
            tr.querySelector('[data-link]').addEventListener('click', async () => {
                const accountId = targetSelect.value;
                const isCustom = accountId === '__custom__';
                const customName = customNameInput.value.trim();
                if (isCustom && !customName) { customNameInput.focus(); return; }
                try {
                    await window.BWApi.apiFetch(`/api/simplefin/connections/${connection.id}/link`, {
                        method: 'POST',
                        body: (accountId && !isCustom)
                            ? { simplefinAccountId: remote.id, accountId }
                            : {
                                simplefinAccountId: remote.id,
                                newAccount: {
                                    name: isCustom ? customName : remote.name,
                                    type: newTypeSelect.value,
                                    onBudget: newOnBudgetCheckbox.checked
                                }
                            }
                    });
                    showSuccess(`Linked "${isCustom ? customName : remote.name}".`);
                    const { connections } = await window.BWApi.apiFetch('/api/simplefin/connections');
                    const refreshed = connections.find((c) => c.id === connection.id) || connection;
                    loadConnections();
                    renderLinkSection(refreshed, remoteAccounts);
                } catch (err) {
                    showError(err);
                }
            });
            linkTbody.appendChild(tr);
        });

        linkSection.hidden = false;
    }

    // ── Unlink modal — reachable from a linked row above ("Manage
    // accounts"), a shortcut to the same POST .../simplefin/unlink the
    // Accounts page's own 🔌 icon uses (see public/js/accounts.js), plus the
    // option to close or delete the account in the same step instead of a
    // separate trip to the Accounts page for that.
    const unlinkOverlay = document.getElementById('sf-unlink-overlay');
    const unlinkError = document.getElementById('sf-unlink-error');
    let pendingUnlink = null; // { account: {id, name}, connection, remoteAccounts }

    function showUnlinkError(err) {
        unlinkError.textContent = (err && err.message) || 'Something went wrong';
        unlinkError.hidden = false;
    }

    function openUnlinkModal(account, connection, remoteAccounts) {
        pendingUnlink = { account, connection, remoteAccounts };
        document.getElementById('sf-unlink-account-name').textContent = `"${account.name}"`;
        unlinkError.hidden = true;
        unlinkOverlay.hidden = false;
    }

    function closeUnlinkModal() {
        pendingUnlink = null;
        unlinkOverlay.hidden = true;
    }

    // Refreshes both the connections table and the still-open "Manage
    // accounts" section after an unlink, same as a plain Link/Unlink action
    // elsewhere on this page — the account no longer shows as linked, so it
    // reappears as a selectable "Create new account"/existing-account row.
    async function afterUnlink(message) {
        const { connection, remoteAccounts } = pendingUnlink;
        closeUnlinkModal();
        showSuccess(message);
        loadConnections();
        try {
            const { connections } = await window.BWApi.apiFetch('/api/simplefin/connections');
            const refreshed = connections.find((c) => c.id === connection.id) || connection;
            renderLinkSection(refreshed, remoteAccounts);
        } catch (err) { /* connections table above already refreshed */ }
    }

    document.getElementById('sf-unlink-cancel-btn').addEventListener('click', closeUnlinkModal);
    unlinkOverlay.addEventListener('click', (e) => {
        if (e.target === unlinkOverlay) closeUnlinkModal();
    });

    document.getElementById('sf-unlink-only-btn').addEventListener('click', async () => {
        if (!pendingUnlink) return;
        try {
            await window.BWApi.apiFetch(`/api/accounts/${pendingUnlink.account.id}/simplefin/unlink`, { method: 'POST' });
            await afterUnlink(`Unlinked "${pendingUnlink.account.name}" — it's back to manual entry.`);
        } catch (err) {
            showUnlinkError(err);
        }
    });

    document.getElementById('sf-unlink-close-btn').addEventListener('click', async () => {
        if (!pendingUnlink) return;
        const { account } = pendingUnlink;
        try {
            await window.BWApi.apiFetch(`/api/accounts/${account.id}/simplefin/unlink`, { method: 'POST' });
            await window.BWApi.apiFetch(`/api/accounts/${account.id}`, { method: 'PUT', body: { closed: true } });
            await afterUnlink(`Unlinked and closed "${account.name}".`);
        } catch (err) {
            showUnlinkError(err);
        }
    });

    document.getElementById('sf-unlink-delete-btn').addEventListener('click', async () => {
        if (!pendingUnlink) return;
        const { account } = pendingUnlink;
        if (!confirm(
            `Permanently delete "${account.name}"? This cannot be undone. If it still has transaction ` +
            `history, deleting it will close it first and remove EVERY transaction posted to it ` +
            `(including its half of any transfers) and every schedule tied to it — not just the account.`
        )) return;
        try {
            await window.BWApi.apiFetch(`/api/accounts/${account.id}/simplefin/unlink`, { method: 'POST' });
            try {
                await window.BWApi.apiFetch(`/api/accounts/${account.id}`, { method: 'DELETE' });
            } catch (err) {
                // 409 = still has transactions (services/database/accounts.js's
                // plain remove() refuses to touch those) — a synced account
                // almost always does. Escalate to the same close-then-force-
                // delete path the Accounts page's own modal offers, rather
                // than making the user go do that separately after already
                // confirming full deletion above.
                if (err.status !== 409) throw err;
                await window.BWApi.apiFetch(`/api/accounts/${account.id}`, { method: 'PUT', body: { closed: true } });
                await window.BWApi.apiFetch(`/api/accounts/${account.id}/force`, { method: 'DELETE' });
            }
            await afterUnlink(`Unlinked and deleted "${account.name}".`);
        } catch (err) {
            showUnlinkError(err);
        }
    });

    async function openLinkSection(connection) {
        try {
            const { remoteAccounts, errors } = await window.BWApi.apiFetch(`/api/simplefin/connections/${connection.id}/remote-accounts`);
            if (errors && errors.length) console.warn('SimpleFIN errors:', errors);
            renderLinkSection(connection, remoteAccounts);
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('sf-connect-btn').addEventListener('click', async () => {
        const setupToken = document.getElementById('sf-setup-token').value.trim();
        const label = document.getElementById('sf-connection-label').value.trim();
        if (!setupToken) return;
        try {
            const { connection, remoteAccounts } = await window.BWApi.apiFetch('/api/simplefin/connections', {
                method: 'POST',
                body: { setupToken, label }
            });
            document.getElementById('sf-setup-token').value = '';
            document.getElementById('sf-connection-label').value = '';
            showSuccess(`Connected "${connection.label}". Choose which accounts to sync below.`);
            loadConnections();
            renderLinkSection(connection, remoteAccounts);
        } catch (err) {
            showError(err);
        }
    });

    document.getElementById('sf-link-done-btn').addEventListener('click', () => {
        linkSection.hidden = true;
    });

    loadConnections();
})();
