(function () {
    const runBtn = document.getElementById('run-report-btn');
    if (!runBtn) return;
    const errorBox = document.getElementById('reports-error');

    // Current calendar month by default ('YYYY-MM') — the arrows below step
    // this and re-run automatically, same pattern as the Budget page. The
    // From/To fields stay live the whole time too: typing a custom range
    // and hitting "Use this range" runs that instead, independent of
    // whatever month the arrows last landed on.
    let month = window.BWDate.todayDateInputValue().slice(0, 7);

    function monthLabel(m) {
        const [year, mon] = m.split('-').map(Number);
        return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' });
    }

    function shiftMonth(m, delta) {
        const [year, mon] = m.split('-').map(Number);
        const d = new Date(Date.UTC(year, mon - 1 + delta, 1));
        return d.toISOString().slice(0, 7);
    }

    // Calendar-month bounds as 'YYYY-MM-DD' for the From/To date inputs —
    // day 0 of the following month is the last day of this one.
    function monthBounds(m) {
        const [year, mon] = m.split('-').map(Number);
        const from = new Date(Date.UTC(year, mon - 1, 1));
        const to = new Date(Date.UTC(year, mon, 0));
        return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    }

    function syncMonthControls() {
        document.getElementById('report-month-label').textContent = monthLabel(month);
        const { from, to } = monthBounds(month);
        document.getElementById('report-from').value = from;
        document.getElementById('report-to').value = to;
    }

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    // Only present (non-null) when the viewed range is exactly one calendar
    // month — see run()'s spendingParams — so budget-vs-actual coloring is
    // never shown against a comparison that wouldn't actually mean anything.
    function budgetFillClass(spentCents, assignedCents) {
        const spent = Math.abs(spentCents);
        if (spent === assignedCents) return 'spend-bar-on-budget';
        return spent > assignedCents ? 'spend-bar-over-budget' : 'spend-bar-under-budget';
    }

    // Category names are user data (created via /api/categories), and they
    // land as SVG text content below — escape so a name containing "&" or
    // "<" can't break the markup this gets parsed as.
    function escapeXml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Horizontal bar chart, one row per category, ranked longest-to-shortest
    // (rows already arrive sorted that way from the server). Same hand-rolled
    // SVG approach as buildIncomeExpenseSvg below — a fluid viewBox with no
    // fixed pixel height, since the row count (and so the natural chart
    // height) varies with however many categories had spending.
    function buildSpendingSvg(rows) {
        const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.totalCents)));
        const rowH = 32, barH = 16;
        const padTop = 6, padBottom = 6;
        const labelWidth = 150, valueWidth = 150;
        const width = 640;
        const barMaxWidth = width - labelWidth - valueWidth;
        const height = rows.length * rowH + padTop + padBottom;

        const bars = rows.map((r, i) => {
            const spentAbs = Math.abs(r.totalCents);
            const barWidth = Math.max(3, (spentAbs / maxAbs) * barMaxWidth);
            const y = padTop + i * rowH;
            const cy = y + barH / 2;
            const hasBudget = r.assignedCents !== null && r.assignedCents !== undefined;
            const fillClass = hasBudget ? budgetFillClass(r.totalCents, r.assignedCents) : 'spend-bar-default';
            const label = escapeXml(r.category ? r.category.name : 'Uncategorized');
            const valueText = escapeXml(
                window.BWMoney.formatCents(r.totalCents) + (hasBudget ? ` / ${window.BWMoney.formatCents(r.assignedCents)}` : '')
            );
            return `
                <text class="spend-bar-label" x="${labelWidth - 10}" y="${cy}" dominant-baseline="middle" text-anchor="end">${label}</text>
                <rect class="spend-bar-fill ${fillClass}" x="${labelWidth}" y="${y}" width="${barWidth}" height="${barH}" rx="3">
                    <title>${label}: ${valueText}</title>
                </rect>
                <text class="spend-bar-value" x="${labelWidth + barMaxWidth + 8}" y="${cy}" dominant-baseline="middle" text-anchor="start">${valueText}</text>
            `;
        }).join('');

        return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Spending by category">${bars}</svg>`;
    }

    function renderSpending(rows) {
        const chart = document.getElementById('spending-chart');
        const legend = document.getElementById('spending-legend');
        if (rows.length === 0) {
            chart.innerHTML = '<div class="empty-state">No spending in this range.</div>';
            legend.hidden = true;
            return;
        }
        legend.hidden = !rows.some(r => r.assignedCents !== null && r.assignedCents !== undefined);
        chart.innerHTML = buildSpendingSvg(rows);
    }

    // 'YYYY-MM' -> "Jan '26" — compact enough to fit as an axis label even
    // with a year's worth of months in the chart at once.
    function monthShortLabel(m) {
        const [year, mon] = m.split('-').map(Number);
        const label = new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
        return `${label} '${String(year).slice(2)}`;
    }

    // Hand-rolled SVG (no charting library — see dragReorder.js's own note
    // on why this app avoids CDN/npm UI dependencies) rendering each month
    // as a single two-tone column split at a zero baseline: the income
    // portion rises above it, the expense portion drops below it, so a
    // month's total bar length already reads as "how much moved" while the
    // split point shows the balance between the two. Net is overlaid as its
    // own line/dots in the accent color, same "single measure, one hue"
    // convention the net-worth trend uses elsewhere on this page.
    function buildIncomeExpenseSvg(rows) {
        const maxCents = Math.max(1, ...rows.map(r => Math.max(r.incomeCents, Math.abs(r.expenseCents))));
        const width = Math.max(rows.length * 64, 320);
        const height = 220;
        const padTop = 14, padBottom = 24, padSide = 12;
        const chartHeight = height - padTop - padBottom;
        const zeroY = padTop + chartHeight / 2;
        const scale = (chartHeight / 2) / maxCents;
        const bandWidth = (width - padSide * 2) / rows.length;
        const barWidth = Math.min(36, bandWidth * 0.5);

        const points = rows.map((r, i) => {
            const netCents = r.incomeCents + r.expenseCents;
            const cx = padSide + i * bandWidth + bandWidth / 2;
            return `${cx},${zeroY - netCents * scale}`;
        });

        const bars = rows.map((r, i) => {
            const netCents = r.incomeCents + r.expenseCents;
            const x = padSide + i * bandWidth + (bandWidth - barWidth) / 2;
            const incomeH = r.incomeCents * scale;
            const expenseH = Math.abs(r.expenseCents) * scale;
            const cx = padSide + i * bandWidth + bandWidth / 2;
            return `
                <rect class="ie-bar-income" x="${x}" y="${zeroY - incomeH}" width="${barWidth}" height="${incomeH}">
                    <title>${r.month} income: ${window.BWMoney.formatCents(r.incomeCents)}</title>
                </rect>
                <rect class="ie-bar-expense" x="${x}" y="${zeroY}" width="${barWidth}" height="${expenseH}">
                    <title>${r.month} expense: ${window.BWMoney.formatCents(r.expenseCents)}</title>
                </rect>
                <circle class="ie-net-dot" cx="${cx}" cy="${zeroY - netCents * scale}" r="3">
                    <title>${r.month} net: ${window.BWMoney.formatCents(netCents)}</title>
                </circle>
                <text class="ie-month-label" x="${cx}" y="${height - 6}" text-anchor="middle">${monthShortLabel(r.month)}</text>
            `;
        }).join('');

        return `
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Monthly income, expense, and net">
                <line class="ie-zero-line" x1="${padSide}" y1="${zeroY}" x2="${width - padSide}" y2="${zeroY}"></line>
                ${bars}
                <polyline class="ie-net-line" points="${points.join(' ')}"></polyline>
            </svg>
        `;
    }

    function renderIncomeExpense(rows) {
        const chart = document.getElementById('income-expense-chart');
        const tbody = document.getElementById('income-expense-tbody');
        if (rows.length === 0) {
            chart.innerHTML = '<div class="empty-state">No transactions in this range.</div>';
            tbody.innerHTML = '';
            return;
        }
        // The chart reads left-to-right chronologically (oldest to newest —
        // reversing a time series would be disorienting), but the table
        // below it lists newest-first, matching the rest of the app's list
        // conventions (register, etc.).
        chart.innerHTML = buildIncomeExpenseSvg(rows);
        tbody.innerHTML = [...rows].reverse().map((r) => {
            const netCents = r.incomeCents + r.expenseCents;
            return `
                <tr>
                    <td>${r.month}</td>
                    <td class="money money-positive">${window.BWMoney.formatCents(r.incomeCents)}</td>
                    <td class="money money-negative">${window.BWMoney.formatCents(r.expenseCents)}</td>
                    <td class="money ${netCents < 0 ? 'money-negative' : 'money-positive'}">${window.BWMoney.formatCents(netCents)}</td>
                </tr>
            `;
        }).join('');
    }

    function renderNetWorth(rows) {
        const tbody = document.getElementById('net-worth-tbody');
        tbody.innerHTML = [...rows].reverse().map(r => `
            <tr><td>${r.month}</td><td class="money ${r.netWorthCents < 0 ? 'money-negative' : 'money-positive'}">${window.BWMoney.formatCents(r.netWorthCents)}</td></tr>
        `).join('');
    }

    async function run() {
        const from = document.getElementById('report-from').value;
        const to = document.getElementById('report-to').value;
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to) params.set('to', to);

        // Budget-vs-actual coloring only makes sense against one exact
        // calendar month's assignedCents — only attach `month` when the
        // currently selected range exactly bounds a single month (true for
        // the month-nav arrows; a hand-picked custom range that doesn't line
        // up with a whole month falls back to the plain ranked bars).
        const spendingParams = new URLSearchParams(params);
        if (from) {
            const guessedMonth = from.slice(0, 7);
            const bounds = monthBounds(guessedMonth);
            if (from === bounds.from && to === bounds.to) spendingParams.set('month', guessedMonth);
        }

        try {
            const [spending, incomeExpense, netWorth] = await Promise.all([
                window.BWApi.apiFetch(`/api/reports/spending-by-category?${spendingParams}`),
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
    document.getElementById('prev-month-btn').addEventListener('click', () => {
        month = shiftMonth(month, -1);
        syncMonthControls();
        run();
    });
    document.getElementById('next-month-btn').addEventListener('click', () => {
        month = shiftMonth(month, 1);
        syncMonthControls();
        run();
    });

    syncMonthControls();
    run();
})();
