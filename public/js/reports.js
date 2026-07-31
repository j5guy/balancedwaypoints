(function () {
    const runBtn = document.getElementById('run-report-btn');
    if (!runBtn) return;
    const errorBox = document.getElementById('reports-error');

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function renderSpending(rows) {
        const list = document.getElementById('spending-bar-list');
        list.innerHTML = '';
        if (rows.length === 0) {
            list.innerHTML = '<div class="empty-state">No spending in this range.</div>';
            return;
        }
        const max = Math.max(...rows.map(r => Math.abs(r.totalCents)));
        rows.forEach(r => {
            const pct = max ? Math.max(4, Math.round((Math.abs(r.totalCents) / max) * 100)) : 4;
            const div = document.createElement('div');
            div.className = 'bar-list-row';
            div.innerHTML = `
                <span class="bar-list-label">${r.category ? r.category.name : 'Uncategorized'}</span>
                <span class="bar-list-track"><span class="bar-list-fill" style="width:${pct}%"></span></span>
                <span class="bar-list-value money">${window.BWMoney.formatCents(r.totalCents)}</span>
            `;
            list.appendChild(div);
        });
    }

    function renderIncomeExpense(rows) {
        const container = document.getElementById('income-expense-list');
        container.innerHTML = '';
        if (rows.length === 0) {
            container.innerHTML = '<div class="empty-state">No transactions in this range.</div>';
            return;
        }
        const max = Math.max(1, ...rows.map(r => Math.max(r.incomeCents, Math.abs(r.expenseCents))));
        rows.forEach(r => {
            const incomePct = Math.round((r.incomeCents / max) * 100);
            const expensePct = Math.round((Math.abs(r.expenseCents) / max) * 100);
            const div = document.createElement('div');
            div.className = 'diverging-row';
            div.innerHTML = `
                <span>${r.month}</span>
                <span class="diverging-income-track"><span class="diverging-fill-income" style="width:${incomePct}%"></span></span>
                <span class="diverging-expense-track"><span class="diverging-fill-expense" style="width:${expensePct}%"></span></span>
            `;
            container.appendChild(div);
        });
    }

    function renderNetWorth(rows) {
        const tbody = document.getElementById('net-worth-tbody');
        tbody.innerHTML = rows.map(r => `
            <tr><td>${r.month}</td><td class="money ${r.netWorthCents < 0 ? 'money-negative' : 'money-positive'}">${window.BWMoney.formatCents(r.netWorthCents)}</td></tr>
        `).join('');
    }

    async function run() {
        const from = document.getElementById('report-from').value;
        const to = document.getElementById('report-to').value;
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);

        try {
            const [spending, incomeExpense, netWorth] = await Promise.all([
                window.BWApi.apiFetch(`/api/reports/spending-by-category?${params}`),
                window.BWApi.apiFetch(`/api/reports/income-vs-expense?${params}`),
                window.BWApi.apiFetch('/api/reports/net-worth?months=12')
            ]);
            renderSpending(spending.rows);
            renderIncomeExpense(incomeExpense.rows);
            renderNetWorth(netWorth.rows);
        } catch (err) {
            showError(err);
        }
    }

    runBtn.addEventListener('click', run);
    run();
})();
