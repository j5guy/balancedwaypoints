(function () {
    const widgetsContainer = document.getElementById('dashboard-widgets');
    if (!widgetsContainer) return;
    const errorBox = document.getElementById('dashboard-error');
    const presetSelect = document.getElementById('dashboard-range-preset');
    const monthNavEl = document.getElementById('dashboard-month-nav');
    const monthLabelEl = document.getElementById('dashboard-month-label');

    // Net Worth/Cash Flow are whole-household only (their report endpoints
    // have no account filter — netWorth.js/incomeVsExpense.js always sum
    // every account), so they're a simple show/hide toggle: at most one
    // instance. The "totals" widgets are backed by /api/reports/summary,
    // which does accept an optional account filter — so those are
    // repeatable: add one per account, plus an overall one, each its own
    // instance. See models/user.js's preferences.dashboard.widgets for the
    // full instance shape ({id, type, accountId}).
    const SINGLETON_WIDGETS = [
        { type: 'netWorth', label: 'Net Worth Graph' },
        { type: 'cashFlow', label: 'Cash Flow Graph' }
    ];
    const TOTALS_WIDGETS = [
        { type: 'summary', label: 'Summary Card' },
        { type: 'totalIncome', label: 'Total Income' },
        { type: 'totalExpense', label: 'Total Expense' },
        { type: 'netBudget', label: 'Net Budget' }
    ];
    const WIDGET_LABELS = Object.fromEntries([...SINGLETON_WIDGETS, ...TOTALS_WIDGETS].map(w => [w.type, w.label]));
    const DEFAULT_WIDGETS = [
        { id: 'summary', type: 'summary', accountId: null },
        { id: 'totalIncome', type: 'totalIncome', accountId: null },
        { id: 'totalExpense', type: 'totalExpense', accountId: null },
        { id: 'netBudget', type: 'netBudget', accountId: null },
        { id: 'netWorth', type: 'netWorth', accountId: null },
        { id: 'cashFlow', type: 'cashFlow', accountId: null }
    ];

    let currentWidgets = DEFAULT_WIDGETS;
    let dateRangePreset = 'month';
    let align = 'center';
    let month = window.BWDate.todayDateInputValue().slice(0, 7); // 'YYYY-MM', only used for the 'month' preset
    let accounts = []; // loaded once in init() — {id, name, closed, ...}

    function makeWidgetId(type) {
        return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }

    function accountLabel(accountId) {
        if (!accountId) return 'All accounts';
        const account = accounts.find(a => a.id === accountId);
        return account ? account.name : 'Unknown account';
    }

    // Applies as a class on the container rather than per-widget — text-align
    // is inherited, so this one rule cascades down to every widget's heading,
    // stat values, and summary-grid cells without needing its own selector
    // per element.
    function applyAlign() {
        widgetsContainer.classList.remove('align-left', 'align-center', 'align-right');
        widgetsContainer.classList.add(`align-${align}`);
    }

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

    function rangeQuery(range, accountId) {
        const params = new URLSearchParams();
        if (range.from) params.set('from', range.from);
        if (range.to) params.set('to', range.to);
        if (accountId) params.set('account', accountId);
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
                body: { dashboard: { widgets: currentWidgets, dateRangePreset, align } }
            });
        } catch (err) {
            showError(err);
        }
    }

    async function loadAccounts() {
        try {
            const res = await window.BWApi.apiFetch('/api/accounts');
            accounts = (res.accounts || []).filter(a => !a.closed);
        } catch (err) {
            accounts = [];
        }
    }

    // 'YYYY-MM' -> "Jan '26" — same compact axis-label format as
    // public/js/reports.js's monthShortLabel.
    function monthShortLabel(m) {
        const [year, mon] = m.split('-').map(Number);
        const label = new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
        return `${label} '${String(year).slice(2)}`;
    }

    // Only labels a handful of points (first/middle/last), never every one —
    // the dataviz "selective direct labels" rule; a label per month would
    // overlap at this widget's width once there are more than ~5 points.
    function axisLabelIndexes(count) {
        if (count <= 2) return [0, count - 1];
        return [0, Math.floor((count - 1) / 2), count - 1];
    }

    // ── Minimal inline-SVG chart helpers (no library — see
    // public/js/reports.js's own note on this app's no-CDN/no-build-step
    // policy) for the two trend widgets. Single-hue for Net Worth (one
    // measure, ranked-over-time), a diverging income/expense pair for Cash
    // Flow — same convention public/scss/components/_reports.scss documents
    // for the Reports page's own charts. Both carry explicit y-axis value
    // labels (min/max) and x-axis month labels — a bare line with no scale
    // reads as decoration, not data.
    function buildSparklineSvg(points) {
        if (points.length < 2) return '<div class="empty-state">Not enough data yet.</div>';
        const width = 400, height = 140;
        const padLeft = 56, padRight = 8, padTop = 12, padBottom = 20;
        const chartW = width - padLeft - padRight;
        const chartH = height - padTop - padBottom;
        const values = points.map(p => p.value);
        const min = Math.min(0, ...values), max = Math.max(0, ...values);
        const range = Math.max(1, max - min);
        const stepX = chartW / (points.length - 1);
        const xAt = (i) => padLeft + i * stepX;
        const yAt = (v) => padTop + chartH - ((v - min) / range) * chartH;
        const coords = points.map((p, i) => `${xAt(i)},${yAt(p.value)}`);

        const xLabels = axisLabelIndexes(points.length).map(i => `
            <text class="trend-axis-label" x="${xAt(i)}" y="${height - 4}" text-anchor="middle">${monthShortLabel(points[i].label)}</text>
        `).join('');
        const zeroY = min < 0 && max > 0 ? yAt(0) : null;

        return `
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Net worth trend">
                <text class="trend-axis-label" x="${padLeft - 6}" y="${padTop + 4}" text-anchor="end">${window.BWMoney.formatCents(max)}</text>
                <text class="trend-axis-label" x="${padLeft - 6}" y="${padTop + chartH + 4}" text-anchor="end">${window.BWMoney.formatCents(min)}</text>
                ${zeroY !== null ? `<line class="trend-zero-line" x1="${padLeft}" y1="${zeroY}" x2="${width - padRight}" y2="${zeroY}"></line>` : ''}
                <polyline class="networth-line" points="${coords.join(' ')}"></polyline>
                ${xLabels}
            </svg>
        `;
    }

    // Both lines on one chart so where income and expense visually cross is
    // plainly visible, without needing a dedicated "crossover" calculation.
    function buildCashFlowSvg(rows) {
        if (rows.length < 2) return '<div class="empty-state">Not enough data yet.</div>';
        const width = 400, height = 140;
        const padLeft = 56, padRight = 8, padTop = 12, padBottom = 20;
        const chartW = width - padLeft - padRight;
        const chartH = height - padTop - padBottom;
        const magnitudes = rows.flatMap(r => [r.incomeCents, Math.abs(r.expenseCents)]);
        const max = Math.max(1, ...magnitudes);
        const stepX = chartW / (rows.length - 1);
        const xAt = (i) => padLeft + i * stepX;
        const yAt = (v) => padTop + chartH - (v / max) * chartH;
        const incomePoints = rows.map((r, i) => `${xAt(i)},${yAt(r.incomeCents)}`);
        const expensePoints = rows.map((r, i) => `${xAt(i)},${yAt(Math.abs(r.expenseCents))}`);

        const xLabels = axisLabelIndexes(rows.length).map(i => `
            <text class="trend-axis-label" x="${xAt(i)}" y="${height - 4}" text-anchor="middle">${monthShortLabel(rows[i].month)}</text>
        `).join('');

        return `
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Cash flow trend">
                <text class="trend-axis-label" x="${padLeft - 6}" y="${padTop + 4}" text-anchor="end">${window.BWMoney.formatCents(max)}</text>
                <text class="trend-axis-label" x="${padLeft - 6}" y="${padTop + chartH + 4}" text-anchor="end">$0</text>
                <polyline class="cashflow-expense-line" points="${expensePoints.join(' ')}"></polyline>
                <polyline class="cashflow-income-line" points="${incomePoints.join(' ')}"></polyline>
                ${xLabels}
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
    // `widget` is a full instance ({id, type, accountId}), not just a type
    // string — the "totals" types render their account scope in the
    // heading so multiple instances of the same type are distinguishable.
    async function buildWidget(widget) {
        const { id, type, accountId } = widget;
        const div = document.createElement('div');
        div.className = 'widget';
        div.draggable = true;
        div.dataset.dragId = id;
        const handle = '<span class="drag-handle">⠿</span>';
        const scopeSuffix = TOTALS_WIDGETS.some(w => w.type === type) ? ` — ${accountLabel(accountId)}` : '';

        if (type === 'summary') {
            div.classList.add('widget-full');
            const s = await window.BWApi.apiFetch(`/api/reports/summary?${rangeQuery(periodRange(dateRangePreset), accountId)}`);
            div.innerHTML = `
                <div class="stat-label">${handle}Summary${scopeSuffix}</div>
                <div class="widget-summary-grid">
                    <div><span class="stat-label">Income</span><div class="stat-value widget-summary-value money-positive">${window.BWMoney.formatCents(s.totalIncomeCents)}</div></div>
                    <div><span class="stat-label">Expense</span><div class="stat-value widget-summary-value money-negative">${window.BWMoney.formatCents(s.totalExpenseCents)}</div></div>
                    <div><span class="stat-label">Net</span><div class="stat-value widget-summary-value ${s.netCents < 0 ? 'money-negative' : 'money-positive'}">${window.BWMoney.formatCents(s.netCents)}</div></div>
                </div>
            `;
            return div;
        }

        if (type === 'totalIncome' || type === 'totalExpense' || type === 'netBudget') {
            const s = await window.BWApi.apiFetch(`/api/reports/summary?${rangeQuery(periodRange(dateRangePreset), accountId)}`);
            const config = {
                totalIncome: { label: 'Total Income', value: s.totalIncomeCents, cls: 'money-positive' },
                totalExpense: { label: 'Total Expense', value: s.totalExpenseCents, cls: 'money-negative' },
                netBudget: { label: 'Net Budget', value: s.netCents, cls: s.netCents < 0 ? 'money-negative' : 'money-positive' }
            }[type];
            div.innerHTML = `<div class="stat-label">${handle}${config.label}${scopeSuffix}</div><div class="stat-value ${config.cls}">${window.BWMoney.formatCents(config.value)}</div>`;
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
            // ids are just the dragged data-drag-id (widget.id) strings —
            // map back to the full instance objects in their new order.
            currentWidgets = ids.map(id => currentWidgets.find(w => w.id === id)).filter(Boolean);
            await saveDashboardPrefs();
        });
    }

    // ── Customize modal ──────────────────────────────────────────────
    // Edits happen on a draft copy so Cancel can discard them cleanly —
    // otherwise an add/remove in the "totals" list would already have
    // mutated currentWidgets before Save is ever clicked.
    const customizeOverlay = document.getElementById('customize-dashboard-overlay');
    const singletonChecklist = document.getElementById('singleton-widget-checklist');
    const totalsListEl = document.getElementById('totals-widget-list');
    const addWidgetType = document.getElementById('add-widget-type');
    const addWidgetAccount = document.getElementById('add-widget-account');
    const alignSelect = document.getElementById('widget-align');
    let draftWidgets = [];

    function buildSingletonChecklist() {
        singletonChecklist.innerHTML = SINGLETON_WIDGETS.map(w => `
            <div class="checkbox-row form-group">
                <input type="checkbox" id="widget-check-${w.type}" data-widget-type="${w.type}" ${draftWidgets.some(dw => dw.type === w.type) ? 'checked' : ''}>
                <label for="widget-check-${w.type}">${w.label}</label>
            </div>
        `).join('');
    }

    function buildTotalsList() {
        const instances = draftWidgets.filter(w => TOTALS_WIDGETS.some(t => t.type === w.type));
        if (instances.length === 0) {
            totalsListEl.innerHTML = '<p class="muted" style="font-size:0.85rem;">None added yet.</p>';
            return;
        }
        totalsListEl.innerHTML = instances.map(w => `
            <div class="widget-instance-row">
                <span>${WIDGET_LABELS[w.type]} — ${accountLabel(w.accountId)}</span>
                <button type="button" class="icon-btn" data-remove-instance="${w.id}" title="Remove" style="border:none;background:none;cursor:pointer;">🗑</button>
            </div>
        `).join('');
        totalsListEl.querySelectorAll('[data-remove-instance]').forEach((btn) => {
            btn.addEventListener('click', () => {
                draftWidgets = draftWidgets.filter(w => w.id !== btn.dataset.removeInstance);
                buildTotalsList();
            });
        });
    }

    function populateAccountSelect() {
        addWidgetAccount.innerHTML = '<option value="">All accounts</option>' +
            accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    }

    document.getElementById('customize-dashboard-btn').addEventListener('click', () => {
        draftWidgets = currentWidgets.map(w => ({ ...w }));
        buildSingletonChecklist();
        populateAccountSelect();
        buildTotalsList();
        alignSelect.value = align;
        customizeOverlay.hidden = false;
    });
    document.getElementById('cancel-widgets-btn').addEventListener('click', () => { customizeOverlay.hidden = true; });
    customizeOverlay.addEventListener('click', (e) => { if (e.target === customizeOverlay) customizeOverlay.hidden = true; });

    document.getElementById('add-widget-btn').addEventListener('click', () => {
        const type = addWidgetType.value;
        const accountId = addWidgetAccount.value || null;
        draftWidgets.push({ id: makeWidgetId(type), type, accountId });
        buildTotalsList();
    });

    document.getElementById('save-widgets-btn').addEventListener('click', async () => {
        const checkedSingletons = [...singletonChecklist.querySelectorAll('input[type=checkbox]:checked')].map(el => el.dataset.widgetType);
        // Drop unchecked singletons; keep everything else (totals instances
        // + still-checked singletons) in whatever order they're already in.
        let widgets = draftWidgets.filter((w) => {
            const isSingleton = SINGLETON_WIDGETS.some(s => s.type === w.type);
            return !isSingleton || checkedSingletons.includes(w.type);
        });
        // Newly-checked singletons that weren't already present land at the end.
        checkedSingletons.forEach((type) => {
            if (!widgets.some(w => w.type === type)) widgets.push({ id: type, type, accountId: null });
        });

        currentWidgets = widgets;
        align = alignSelect.value;
        applyAlign();
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
            await loadAccounts();
            const prefs = await window.BWApi.apiFetch('/api/auth/preferences');
            const dash = prefs.dashboard || { widgets: DEFAULT_WIDGETS, dateRangePreset: 'month', align: 'center' };
            currentWidgets = dash.widgets && dash.widgets.length ? dash.widgets : DEFAULT_WIDGETS;
            dateRangePreset = dash.dateRangePreset || 'month';
            align = dash.align || 'center';
            applyAlign();
            syncRangeControls();
            await renderWidgets();
        } catch (err) {
            showError(err);
        }
    }

    init();
})();
