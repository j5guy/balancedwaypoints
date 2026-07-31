(function () {
    const grid = document.getElementById('accounts-grid');
    if (!grid) return;
    const errorBox = document.getElementById('accounts-error');
    const form = document.getElementById('account-form');
    let editingId = null;
    let accountsCache = [];

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function accountCard(account) {
        const el = document.createElement('div');
        el.className = 'stat-card';
        el.draggable = true;
        el.dataset.dragId = account.id;
        const balanceClass = account.balanceCents < 0 ? 'money-negative' : 'money-positive';
        el.innerHTML = `
            <div style="display:flex;align-items:flex-start;gap:6px;">
                <span class="drag-handle">⠿</span>
                <a href="/accounts/${account.id}" draggable="false" style="text-decoration:none;color:inherit;display:block;flex:1;min-width:0;">
                    <div class="stat-label">${account.name}${account.closed ? ' (closed)' : ''}</div>
                    <div class="stat-value money ${balanceClass}">${window.BWMoney.formatCents(account.balanceCents)}</div>
                    <div class="muted" style="font-size:0.8rem;margin-top:4px;text-transform:capitalize;">${account.type}${account.onBudget ? '' : ' &middot; off budget'}</div>
                </a>
            </div>
            <div class="btn-row" style="margin-top:10px;">
                <button type="button" class="btn btn-secondary btn-sm" data-edit>Edit</button>
            </div>
        `;
        el.querySelector('[data-edit]').addEventListener('click', () => startEdit(account));
        return el;
    }

    async function load() {
        try {
            const { accounts } = await window.BWApi.apiFetch('/api/accounts');
            accountsCache = accounts;
            grid.innerHTML = '';
            document.getElementById('accounts-hint').hidden = accounts.length < 2;
            if (accounts.length === 0) {
                grid.innerHTML = '<div class="empty-state">No accounts yet — add one above.</div>';
                return;
            }
            accounts.forEach(a => grid.appendChild(accountCard(a)));
            window.BWDragReorder.makeSortable(grid, async (ids) => {
                try {
                    await Promise.all(ids.map((id, i) => window.BWApi.apiFetch(`/api/accounts/${id}`, { method: 'PUT', body: { sortOrder: ids.length - i } })));
                } catch (err) {
                    showError(err);
                }
            });
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

    load();
})();
