(function () {
    const widgetsContainer = document.getElementById('dashboard-widgets');
    if (!widgetsContainer) return;
    const errorBox = document.getElementById('dashboard-error');
    const presetSelect = document.getElementById('dashboard-range-preset');
    const monthNavEl = document.getElementById('dashboard-month-nav');
    const monthLabelEl = document.getElementById('dashboard-month-label');

    // Every widget type the "Customize" checklist can offer — kept in sync
    // with the server-side whitelist in controllers/authController.js's
    // sanitizeDashboard, which is the one that actually enforces it; this
    // list is just what the checklist UI renders.
    const WIDGET_CATALOG = [
        { type: 'summary', label: 'Summary Card' },
        { type: 'totalIncome', label: 'Total Income' },
        { type: 'totalExpense', label: 'Total Expense' },
        { type: 'netBudget', label: 'Net Budget' },
        { type: 'netWorth', label: 'Net Worth Graph' },
        { type: 'cashFlow', label: 'Cash Flow Graph' }
    ];
    const DEFAULT_WIDGETS = WIDGET_CATALOG.map(w => w.type);

    let currentWidgets = DEFAULT_WIDGETS;
    let dateRangePreset = 'month';
    let month = window.BWDate.todayDateInputValue().slice(0, 7); // 'YYYY-MM', only used for the 'month' preset

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    // ── Date-range math — same monthBounds()/shiftMonth() shape as
    // reports.js/budget.js, each page keeping its own small copy rather than
    // sharing a module (matches this app's existing convention).
    function monthLabel(m) {
        const [year, mon] = m.split('-').map(Number);
        return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' });
    }

    function shiftMonth(m, delta) {
        const [year, mon] = m.split('-').map(Number);
        const d = new Date(Date.UTC(year, mon - 1 + delta, 1));
        return d.toISOString().slice(0, 7);
    }

    function monthBounds(m) {
        const [year, mon] = m.split('-').map(Number);
        const from = new Date(Date.UTC(year, mon - 1, 1));
        const to = new Date(Date.UTC(year, mon, 0));
        return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    }

    // Trailing N calendar months ending this month — used both for
    // last3/last6/last12 period totals and (via trendMonths below) for the
    // trend widgets' window.
    function trailingRange(months) {
        const now = new Date();
        const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
        const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
        return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    }

    function yearRange() {
        const year = new Date().getUTCFullYear();
        return { from: `${year}-01-01`, to: `${year}-12-31` };
    }

    // {from:null, to:null} for period-total widgets means "all time" —
    // services/reports/summary.js already treats an absent from/to as no
    // date filter at all.
    function periodRange(preset) {
        if (preset === 'month') return monthBounds(month);
        if (preset === 'last3') return trailingRange(3);
        if (preset === 'last6') return trailingRange(6);
        if (preset === 'last12') return trailingRange(12);
        if (preset === 'year') return yearRange();
        return { from: null, to: null };
    }

    // The two trend widgets (Net Worth, Cash Flow) always show a trailing
    // window rather than the literal selected range — a single month's
    // trend line isn't meaningful, so 'month'/'year'/'all' all fall back to
    // a sensible trailing 12 months.
    function trendMonths(preset) {
        if (preset === 'last3') return 3;
        if (preset === 'last6') return 6;
        return 12;
    }

    function rangeQuery(range) {
        const params = new URLSearchParams();
        if (range.from) params.set('from', range.from);
        if (range.to) params.set('to', range.to);
        return params.toString();
    }

    function syncRangeControls() {
        presetSelect.value = dateRangePreset;
        monthNavEl.hidden = dateRangePreset !== 'month';
        if (dateRangePreset === 'month') monthLabelEl.textContent = monthLabel(month);
    }

    async function saveDashboardPrefs() {
        try {
            await window.BWApi.apiFetch('/api/auth/preferences', {
                method: 'PUT',
                body: { dashboard: { widgets: currentWidgets, dateRangePreset } }
            });
        } catch (err) {
            showError(err);
        }
    }

    // ── Minimal inline-SVG chart helpers (no library — see
    // public/js/reports.js's own note on this app's no-CDN/no-build-step
    // policy) for the two trend widgets. Single-hue for Net Worth (one
    // measure, ranked-over-time), a diverging income/expense pair for Cash
    // Flow — same convention public/scss/components/_reports.scss documents
    // for the Reports page's own charts.
    function buildSparklineSvg(points) {
        if (points.length < 2) return '<div class="empty-state">Not enough data yet.</div>';
        const width = 400, height = 100, pad = 8;
        const values = points.map(p => p.value);
        const min = Math.min(0, ...values), max = Math.max(0, ...values);
        const range = Math.max(1, max - min);
        const stepX = (width - pad * 2) / (points.length - 1);
        const y = (v) => height - pad - ((v - min) / range) * (height - pad * 2);
        const coords = points.map((p, i) => `${pad + i * stepX},${y(p.value)}`);
        const last = points[points.length - 1];
        return `
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Net worth trend">
                <polyline class="networth-line" points="${coords.join(' ')}"></polyline>
            </svg>
            <div class="widget-chart-footer"><span>${points[0].label}</span><span class="money">${window.BWMoney.formatCents(last.value)}</span></div>
        `;
    }

    // Both lines on one chart so where income and expense visually cross is
    // plainly visible, without needing a dedicated "crossover" calculation.
    function buildCashFlowSvg(rows) {
        if (rows.length < 2) return '<div class="empty-state">Not enough data yet.</div>';
        const width = 400, height = 100, pad = 8;
        const magnitudes = rows.flatMap(r => [r.incomeCents, Math.abs(r.expenseCents)]);
        const max = Math.max(1, ...magnitudes);
        const stepX = (width - pad * 2) / (rows.length - 1);
        const y = (v) => height - pad - (v / max) * (height - pad * 2);
        const incomePoints = rows.map((r, i) => `${pad + i * stepX},${y(r.incomeCents)}`);
        const expensePoints = rows.map((r, i) => `${pad + i * stepX},${y(Math.abs(r.expenseCents))}`);
        return `
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Cash flow trend">
                <polyline class="cashflow-expense-line" points="${expensePoints.join(' ')}"></polyline>
                <polyline class="cashflow-income-line" points="${incomePoints.join(' ')}"></polyline>
            </svg>
            <div class="diverging-legend">
                <span class="legend-income"><span class="legend-swatch"></span>Income</span>
                <span class="legend-expense"><span class="legend-swatch"></span>Expense</span>
            </div>
        `;
    }

    // ── Widget builders — each returns a draggable .widget element, or null
    // for an unknown/removed widget type (defensive: a stored preference
    // could reference a type that no longer exists after a future change).
    async function buildWidget(type) {
        const div = document.createElement('div');
        div.className = 'widget';
        div.draggable = true;
        div.dataset.dragId = type;
        const handle = '<span class="drag-handle">⠿</span>';

        if (type === 'summary') {
            const s = await window.BWApi.apiFetch(`/api/reports/summary?${rangeQuery(periodRange(dateRangePreset))}`);
            div.innerHTML = `
                <div class="stat-label">${handle}Summary</div>
                <div class="widget-summary-grid">
                    <div><span class="stat-label">Income</span><div class="stat-value money-positive">${window.BWMoney.formatCents(s.totalIncomeCents)}</div></div>
                    <div><span class="stat-label">Expense</span><div class="stat-value money-negative">${window.BWMoney.formatCents(s.totalExpenseCents)}</div></div>
                    <div><span class="stat-label">Net</span><div class="stat-value ${s.netCents < 0 ? 'money-negative' : 'money-positive'}">${window.BWMoney.formatCents(s.netCents)}</div></div>
                </div>
            `;
            return div;
        }

        if (type === 'totalIncome' || type === 'totalExpense' || type === 'netBudget') {
            const s = await window.BWApi.apiFetch(`/api/reports/summary?${rangeQuery(periodRange(dateRangePreset))}`);
            const config = {
                totalIncome: { label: 'Total Income', value: s.totalIncomeCents, cls: 'money-positive' },
                totalExpense: { label: 'Total Expense', value: s.totalExpenseCents, cls: 'money-negative' },
                netBudget: { label: 'Net Budget', value: s.netCents, cls: s.netCents < 0 ? 'money-negative' : 'money-positive' }
            }[type];
            div.innerHTML = `<div class="stat-label">${handle}${config.label}</div><div class="stat-value ${config.cls}">${window.BWMoney.formatCents(config.value)}</div>`;
            return div;
        }

        if (type === 'netWorth') {
            div.classList.add('widget-wide');
            const { rows } = await window.BWApi.apiFetch(`/api/reports/net-worth?months=${trendMonths(dateRangePreset)}`);
            div.innerHTML = `<div class="stat-label">${handle}Net Worth</div><div class="widget-chart"></div>`;
            div.querySelector('.widget-chart').innerHTML = buildSparklineSvg(rows.map(r => ({ label: r.month, value: r.netWorthCents })));
            return div;
        }

        if (type === 'cashFlow') {
            div.classList.add('widget-wide');
            const { rows } = await window.BWApi.apiFetch(`/api/reports/income-vs-expense?${rangeQuery(trailingRange(trendMonths(dateRangePreset)))}`);
            div.innerHTML = `<div class="stat-label">${handle}Cash Flow</div><div class="widget-chart"></div>`;
            div.querySelector('.widget-chart').innerHTML = buildCashFlowSvg(rows);
            return div;
        }

        return null;
    }

    async function renderWidgets() {
        const elements = await Promise.all(currentWidgets.map(buildWidget));
        widgetsContainer.innerHTML = '';
        elements.forEach(el => { if (el) widgetsContainer.appendChild(el); });
        window.BWDragReorder.makeSortable(widgetsContainer, async (ids) => {
            currentWidgets = ids;
            await saveDashboardPrefs();
        });
    }

    // ── Customize modal ──────────────────────────────────────────────
    const customizeOverlay = document.getElementById('customize-dashboard-overlay');
    const checklistContainer = document.getElementById('widget-checklist');

    function buildWidgetChecklist() {
        checklistContainer.innerHTML = WIDGET_CATALOG.map(w => `
            <div class="checkbox-row form-group">
                <input type="checkbox" id="widget-check-${w.type}" data-widget-type="${w.type}" ${currentWidgets.includes(w.type) ? 'checked' : ''}>
                <label for="widget-check-${w.type}">${w.label}</label>
            </div>
        `).join('');
    }

    document.getElementById('customize-dashboard-btn').addEventListener('click', () => {
        buildWidgetChecklist();
        customizeOverlay.hidden = false;
    });
    document.getElementById('cancel-widgets-btn').addEventListener('click', () => { customizeOverlay.hidden = true; });
    customizeOverlay.addEventListener('click', (e) => { if (e.target === customizeOverlay) customizeOverlay.hidden = true; });

    document.getElementById('save-widgets-btn').addEventListener('click', async () => {
        const checked = [...checklistContainer.querySelectorAll('input[type=checkbox]:checked')].map(el => el.dataset.widgetType);
        // Keep whatever relative order was already on the dashboard for
        // widgets that stay enabled; newly-checked ones land at the end.
        currentWidgets = currentWidgets.filter(t => checked.includes(t)).concat(checked.filter(t => !currentWidgets.includes(t)));
        customizeOverlay.hidden = true;
        await saveDashboardPrefs();
        await renderWidgets();
    });

    // ── Date-range controls ──────────────────────────────────────────
    presetSelect.addEventListener('change', async () => {
        dateRangePreset = presetSelect.value;
        syncRangeControls();
        await saveDashboardPrefs();
        await renderWidgets();
    });
    document.getElementById('dashboard-prev-month-btn').addEventListener('click', async () => {
        month = shiftMonth(month, -1);
        syncRangeControls();
        await renderWidgets();
    });
    document.getElementById('dashboard-next-month-btn').addEventListener('click', async () => {
        month = shiftMonth(month, 1);
        syncRangeControls();
        await renderWidgets();
    });

    async function init() {
        try {
            const prefs = await window.BWApi.apiFetch('/api/auth/preferences');
            const dash = prefs.dashboard || { widgets: DEFAULT_WIDGETS, dateRangePreset: 'month' };
            currentWidgets = dash.widgets && dash.widgets.length ? dash.widgets : DEFAULT_WIDGETS;
            dateRangePreset = dash.dateRangePreset || 'month';
            syncRangeControls();
            await renderWidgets();
        } catch (err) {
            showError(err);
        }
    }

    init();
})();
