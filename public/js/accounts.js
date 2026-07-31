(function () {
    const grid = document.getElementById('accounts-grid');
    if (!grid) return;
    const errorBox = document.getElementById('accounts-error');
    const newForm = document.getElementById('new-account-form');

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function accountCard(account) {
        const el = document.createElement('a');
        el.className = 'stat-card';
        el.href = `/accounts/${account.id}`;
        el.style.textDecoration = 'none';
        el.style.color = 'inherit';
        el.style.display = 'block';
        const balanceClass = account.balanceCents < 0 ? 'money-negative' : 'money-positive';
        el.innerHTML = `
            <div class="stat-label">${account.name}${account.closed ? ' (closed)' : ''}</div>
            <div class="stat-value money ${balanceClass}">${window.BWMoney.formatCents(account.balanceCents)}</div>
            <div class="muted" style="font-size:0.8rem;margin-top:4px;text-transform:capitalize;">${account.type}${account.onBudget ? '' : ' &middot; off budget'}</div>
        `;
        return el;
    }

    async function load() {
        try {
            const { accounts } = await window.BWApi.apiFetch('/api/accounts');
            grid.innerHTML = '';
            if (accounts.length === 0) {
                grid.innerHTML = '<div class="empty-state">No accounts yet — add one above.</div>';
                return;
            }
            accounts.forEach(a => grid.appendChild(accountCard(a)));
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('new-account-btn').addEventListener('click', () => {
        newForm.hidden = !newForm.hidden;
    });
    document.getElementById('cancel-account-btn').addEventListener('click', () => {
        newForm.hidden = true;
    });
    document.getElementById('save-account-btn').addEventListener('click', async () => {
        const name = document.getElementById('acct-name').value.trim();
        if (!name) return;
        try {
            await window.BWApi.apiFetch('/api/accounts', {
                method: 'POST',
                body: {
                    name,
                    type: document.getElementById('acct-type').value,
                    startingBalanceCents: window.BWMoney.toCents(document.getElementById('acct-balance').value || 0),
                    onBudget: document.getElementById('acct-on-budget').checked
                }
            });
            newForm.hidden = true;
            document.getElementById('acct-name').value = '';
            document.getElementById('acct-balance').value = '0';
            load();
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
