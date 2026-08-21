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
                tr.innerHTML = `<td>${orgLabel}</td><td class="money">${balance}</td><td colspan="2">Linked to <strong>${already.name}</strong></td>`;
                linkTbody.appendChild(tr);
                return;
            }

            const options = ['<option value="">Create new account: "' + remote.name + '"</option>']
                .concat(localAccounts.map((a) => `<option value="${a.id}">${a.name}</option>`));
            tr.innerHTML = `
                <td>${orgLabel}</td>
                <td class="money">${balance}</td>
                <td><select data-target>${options.join('')}</select></td>
                <td><button type="button" class="btn btn-primary btn-sm" data-link>Link</button></td>
            `;
            tr.querySelector('[data-link]').addEventListener('click', async () => {
                const accountId = tr.querySelector('[data-target]').value;
                try {
                    await window.BWApi.apiFetch(`/api/simplefin/connections/${connection.id}/link`, {
                        method: 'POST',
                        body: accountId
                            ? { simplefinAccountId: remote.id, accountId }
                            : { simplefinAccountId: remote.id, newAccount: { name: remote.name, type: 'checking' } }
                    });
                    showSuccess(`Linked "${remote.name}".`);
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
