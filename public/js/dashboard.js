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
        { type: 'cashFlow', label: 'Cash Flow Graph' },
        { type: 'spendingPie', label: 'Spending by Category (Pie)' }
    ];
    const TOTALS_WIDGETS = [
        { type: 'summary', label: 'Summary Card' },
        { type: 'totalIncome', label: 'Total Income' },
        { type: 'totalExpense', label: 'Total Expense' },
        { type: 'netBudget', label: 'Net Budget' }
    ];
    // Forecast is per-account like the totals widgets (repeatable — one per
    // account), but isn't a "total": it needs its own past/future window and
    // low-balance threshold per instance, not just an account id, so it gets
    // its own catalog/category and its own add-form in the Customize modal
    // rather than reusing the totals add-row.
    const FORECAST_WIDGET = { type: 'forecast', label: 'Account Forecast' };
    // Account Balance is also per-account like Forecast (no "All accounts"
    // option — a balance is inherently one account's), but unlike every
    // other widget it's not scoped to the dashboard's date-range preset at
    // all (it's just the account's current balance, same figure the
    // Accounts page shows) and it's clickable straight through to that
    // account's register — see buildWidget's 'accountBalance' case.
    const ACCOUNT_BALANCE_WIDGET = { type: 'accountBalance', label: 'Account Balance' };
    const WIDGET_LABELS = Object.fromEntries([...SINGLETON_WIDGETS, ...TOTALS_WIDGETS, FORECAST_WIDGET, ACCOUNT_BALANCE_WIDGET].map(w => [w.type, w.label]));
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
    let categories = []; // loaded once in init() — {id, name, group, sortOrder, archived}, for the spendingPie widget's category picker

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
            const [ownedRes, sharedRes] = await Promise.all([
                window.BWApi.apiFetch('/api/accounts'),
                window.BWApi.apiFetch('/api/accounts/shared-with-me')
            ]);
            const owned = (ownedRes.accounts || []).filter(a => !a.closed);
            // Labeled "Account (Owner)" to disambiguate from your own — a
            // Summary/Total Income/Total Expense/Net Budget/Forecast widget
            // can point at one shared account (services/reports/summary.js's
            // ownerForAccount), even though Reports/Dashboard totals
            // otherwise stay owner-only (see the Phase 2 plan). Net Worth/
            // Cash Flow/Spending-by-Category are whole-household singletons
            // with no account filter at all, so they're untouched by this.
            const shared = (sharedRes.accounts || []).filter(a => !a.closed).map(a => ({ ...a, name: `${a.name} (${a.ownerName})` }));
            accounts = [...owned, ...shared];
        } catch (err) {
            accounts = [];
        }
    }

    async function loadCategories() {
        try {
            const { categories: res } = await window.BWApi.apiFetch('/api/categories');
            categories = res || [];
        } catch (err) {
            categories = [];
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

    // Category names are user data (created via /api/categories) and land
    // as chart/legend markup below — same reasoning as public/js/reports.js's
    // own escapeXml, just covering HTML's escapes too since this lands via
    // innerHTML rather than being built as SVG text nodes.
    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Assigns a category a stable categorical-palette slot from its own id
    // (falling back to its name), not its current rank by spend — the
    // dataviz rule "color follows the entity, never its rank": if the same
    // category is #1 this month and #3 next month, it should stay the same
    // color both times, not repaint. A cheap string hash is enough here;
    // exact uniform distribution across the 5 slots doesn't matter, and a
    // rare collision just means two categories share a color (still
    // distinguishable via the legend's labels).
    function categoryColorSlot(key) {
        let hash = 0;
        for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
        return (hash % 5) + 1;
    }

    // ── Minimal inline-SVG chart helpers (no library — see
    // public/js/reports.js's own note on this app's no-CDN/no-build-step
    // policy) for the two trend widgets. Single-hue for Net Worth (one
    // measure, ranked-over-time), a diverging income/expense pair for Cash
    // Flow — same convention public/scss/components/_reports.scss documents
    // for the Reports page's own charts. Both carry explicit y-axis value
    // labels (min/max) and x-axis month labels — a bare line with no scale
    // reads as decoration, not data.
    // Returns { html, columns, bounds } rather than a plain string — the
    // caller (buildWidget) inserts `html` first, then calls
    // window.BWChartHover.attach() with `columns`/`bounds` once the <svg>
    // is actually in the DOM (hover needs real layout to size against).
    // `columns` is [] for the empty-state case; attach() no-ops on that.
    function buildSparklineSvg(points) {
        if (points.length < 2) return { html: '<div class="empty-state">Not enough data yet.</div>', columns: [] };
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

        // Anchor the first/last labels start/end (growing inward) instead
        // of middle (growing both ways) — they sit right at the chart's
        // edges, and middle-anchoring the last one overflows the viewBox.
        const monthLabelIndexes = axisLabelIndexes(points.length);
        const xLabels = monthLabelIndexes.map((i, pos) => {
            const anchor = pos === 0 ? 'start' : pos === monthLabelIndexes.length - 1 ? 'end' : 'middle';
            return `<text class="trend-axis-label" x="${xAt(i)}" y="${height - 4}" text-anchor="${anchor}">${monthShortLabel(points[i].label)}</text>`;
        }).join('');
        const zeroY = min < 0 && max > 0 ? yAt(0) : null;

        const html = `
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Net worth trend">
                <text class="trend-axis-label" x="${padLeft - 6}" y="${padTop + 4}" text-anchor="end">${window.BWMoney.formatCents(max)}</text>
                <text class="trend-axis-label" x="${padLeft - 6}" y="${padTop + chartH + 4}" text-anchor="end">${window.BWMoney.formatCents(min)}</text>
                ${zeroY !== null ? `<line class="trend-zero-line" x1="${padLeft}" y1="${zeroY}" x2="${width - padRight}" y2="${zeroY}"></line>` : ''}
                <polyline class="networth-line" points="${coords.join(' ')}"></polyline>
                ${xLabels}
            </svg>
        `;
        const columns = points.map((p, i) => ({
            x: xAt(i),
            label: monthShortLabel(p.label),
            series: [{ name: 'Net worth', value: p.value, y: yAt(p.value), colorClass: 'networth-line', formattedValue: window.BWMoney.formatCents(p.value) }]
        }));
        return { html, columns, bounds: { xLeft: padLeft, xRight: width - padRight, yTop: padTop, yBottom: padTop + chartH } };
    }

    // Both lines on one chart so where income and expense visually cross is
    // plainly visible, without needing a dedicated "crossover" calculation.
    function buildCashFlowSvg(rows) {
        if (rows.length < 2) return { html: '<div class="empty-state">Not enough data yet.</div>', columns: [] };
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

        // See the net-worth chart's identical comment above — start/end
        // anchoring for the edge labels keeps the last one from overflowing
        // the viewBox.
        const cashFlowLabelIndexes = axisLabelIndexes(rows.length);
        const xLabels = cashFlowLabelIndexes.map((i, pos) => {
            const anchor = pos === 0 ? 'start' : pos === cashFlowLabelIndexes.length - 1 ? 'end' : 'middle';
            return `<text class="trend-axis-label" x="${xAt(i)}" y="${height - 4}" text-anchor="${anchor}">${monthShortLabel(rows[i].month)}</text>`;
        }).join('');

        const html = `
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
        const columns = rows.map((r, i) => ({
            x: xAt(i),
            label: monthShortLabel(r.month),
            series: [
                { name: 'Income', value: r.incomeCents, y: yAt(r.incomeCents), colorClass: 'cashflow-income-line', formattedValue: window.BWMoney.formatCents(r.incomeCents) },
                { name: 'Expense', value: r.expenseCents, y: yAt(Math.abs(r.expenseCents)), colorClass: 'cashflow-expense-line', formattedValue: window.BWMoney.formatCents(r.expenseCents) }
            ]
        }));
        return { html, columns, bounds: { xLeft: padLeft, xRight: width - padRight, yTop: padTop, yBottom: padTop + chartH } };
    }

    // Running balance from the account's real past transactions (solid
    // line) into scheduled-transaction projections (dashed line) — the two
    // segments share their junction point ("today") so the line reads as
    // continuous rather than visibly breaking where actual data ends. The
    // red band is a fixed "danger zone" behind the line for any balance
    // under `thresholdCents`, not per-segment line coloring — reads more
    // like a low-balance warning strip than a line-color change would.
    // Rounds to a "nice" (1/2/5 × 10^n) step so gridlines land on clean
    // dollar amounts (e.g. $1,000, $2,000) rather than the chart's actual
    // min/max — marks-and-anatomy.md's "round to clean numbers" guidance,
    // just computed per-account since the balance range varies. Clamped to
    // at least $1 so a pathologically tiny range can't divide-by-near-zero
    // into an unreasonable number of lines.
    // Every distinct FUTURE dip below the threshold — not just the first
    // match in `rows` overall (which, since rows runs past-then-future,
    // could be a historical dip that then hides every actually-upcoming
    // one) and not one row per day of a multi-day dip (only the moment it
    // *enters* danger territory is the story — see the dataviz "label
    // selectively" guidance below). `wasBelow` resets the moment the
    // projected segment starts, so an account that's already under
    // threshold today still gets its first projected day flagged, rather
    // than treating an already-ongoing dip as "nothing new."
    function findThresholdCrossings(rows, thresholdCents) {
        const crossings = [];
        let inProjected = false;
        let wasBelow = false;
        rows.forEach((r, i) => {
            if (r.projected && !inProjected) { inProjected = true; wasBelow = false; }
            if (!inProjected) return;
            const isBelow = r.balanceCents < thresholdCents;
            if (isBelow && !wasBelow) crossings.push({ ...r, index: i });
            wasBelow = isBelow;
        });
        return crossings;
    }

    // Every individual FUTURE calendar day below the threshold, not just the
    // moment each dip starts (that's findThresholdCrossings above, still used
    // for the chart's dots since the x-axis only has one position per
    // occurrence). Rows are sparse in the future segment (one point per
    // schedule occurrence, balance flat in between — see forecast.js), so
    // each below-threshold row's balance is expanded across every day up to
    // (not including) the next row's date. The final row has no following
    // row to bound it, so it only contributes its own day — the forecast
    // window's true end date isn't part of `rows` to expand against.
    function findThresholdDays(rows, thresholdCents) {
        const days = [];
        let inProjected = false;
        rows.forEach((r, i) => {
            if (r.projected && !inProjected) inProjected = true;
            if (!inProjected) return;
            if (r.balanceCents >= thresholdCents) return;
            const start = new Date(`${r.date}T00:00:00Z`);
            const next = rows[i + 1];
            const end = next ? new Date(`${next.date}T00:00:00Z`) : new Date(start.getTime() + 86400000);
            for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
                days.push({ date: d.toISOString().slice(0, 10), balanceCents: r.balanceCents });
            }
        });
        return days;
    }

    function niceStepCents(rangeCents, targetLines) {
        const roughDollars = Math.max(1, (rangeCents / 100) / targetLines);
        const magnitude = Math.pow(10, Math.floor(Math.log10(roughDollars)));
        const residual = roughDollars / magnitude;
        let niceResidual;
        if (residual < 1.5) niceResidual = 1;
        else if (residual < 3.5) niceResidual = 2;
        else if (residual < 7.5) niceResidual = 5;
        else niceResidual = 10;
        return niceResidual * magnitude * 100; // back to cents
    }

    // Wider virtual canvas than the other trend widgets (400) — this is the
    // one chart that goes full-width (.widget-full, see buildWidget), and a
    // 400-wide viewBox under a fixed-height CSS box left most of a wide
    // container empty (preserveAspectRatio scales to the *height*-bound
    // factor, pinned to the left) instead of actually stretching. Paired
    // with the aspect-ratio CSS override below, which keeps the rendered
    // box's proportions matched to this viewBox so nothing needs to letterbox
    // or distort text to fill the width.
    function buildForecastSvg(rows, thresholdCents) {
        if (rows.length < 2) return { html: '<div class="empty-state">Not enough data yet.</div>', columns: [] };
        const width = 900, height = 140;
        const padLeft = 56, padRight = 8, padTop = 12, padBottom = 20;
        const chartW = width - padLeft - padRight;
        const chartH = height - padTop - padBottom;
        const values = rows.map(r => r.balanceCents);
        // thresholdCents is folded into the min/max so the danger line/band
        // is always inside the visible chart, even if the account's balance
        // never actually gets close to it.
        const min = Math.min(0, thresholdCents, ...values);
        const max = Math.max(0, thresholdCents, ...values);
        const range = Math.max(1, max - min);
        const stepX = chartW / (rows.length - 1);
        const xAt = (i) => padLeft + i * stepX;
        const yAt = (v) => padTop + chartH - ((v - min) / range) * chartH;

        const firstProjected = rows.findIndex(r => r.projected);
        const pastEnd = firstProjected === -1 ? rows.length - 1 : firstProjected;
        const pastCoords = rows.slice(0, pastEnd + 1).map((r, i) => `${xAt(i)},${yAt(r.balanceCents)}`);
        const futureCoords = rows.slice(pastEnd).map((r, i) => `${xAt(pastEnd + i)},${yAt(r.balanceCents)}`);

        const thresholdY = yAt(thresholdCents);
        const dangerBottom = padTop + chartH;
        const dangerHeight = dangerBottom - thresholdY;

        // Horizontal gridlines every "nice" ~$1,000-ish step instead of
        // just the two extremes — reading off a projected balance partway
        // through the chart needs more than one reference point on the
        // scale. Drawn first so they sit behind the danger zone/line as the
        // recessive base layer (dataviz: "gridlines / axes ... recessive").
        const gridStep = niceStepCents(range, 4);
        const gridLines = [];
        for (let v = Math.ceil(min / gridStep) * gridStep; v <= max; v += gridStep) {
            const y = yAt(v);
            gridLines.push(`
                <line class="forecast-grid-line" x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}"></line>
                <text class="trend-axis-label" x="${padLeft - 6}" y="${y + 3}" text-anchor="end">${window.BWMoney.formatCents(v)}</text>
            `);
        }

        // See the net-worth chart's identical comment above — start/end
        // anchoring for the edge labels keeps the last one from overflowing
        // the viewBox.
        const forecastLabelIndexes = axisLabelIndexes(rows.length);
        const xLabels = forecastLabelIndexes.map((i, pos) => {
            const anchor = pos === 0 ? 'start' : pos === forecastLabelIndexes.length - 1 ? 'end' : 'middle';
            return `<text class="trend-axis-label" x="${xAt(i)}" y="${height - 4}" text-anchor="${anchor}">${window.BWDate.formatDate(rows[i].date)}</text>`;
        }).join('');

        // Chart dots mark just the moment each FUTURE dip starts (one per
        // occurrence-spaced row, via findThresholdCrossings — a dot per day
        // isn't meaningful when the x-axis only has one position per
        // occurrence). The text list below is the opposite: every individual
        // day below the threshold (findThresholdDays), so a multi-day dip
        // reads as a full day-by-day list rather than a single "starts here"
        // line. Text sits outside the SVG since a coordinate label risks
        // colliding with the axis/grid labels at this widget's compact size.
        const crossings = findThresholdCrossings(rows, thresholdCents);
        const markers = crossings.map(c => `<circle class="forecast-threshold-marker" cx="${xAt(c.index)}" cy="${yAt(c.balanceCents)}" r="4"></circle>`).join('');
        const belowDays = findThresholdDays(rows, thresholdCents);
        const callouts = belowDays.map(d => `<div class="forecast-warning">⚠ Below ${window.BWMoney.formatCents(thresholdCents)} on ${window.BWDate.formatDate(d.date)} — projected balance ${window.BWMoney.formatCents(d.balanceCents)}</div>`).join('');

        const html = `
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Account forecast">
                ${gridLines.join('')}
                ${dangerHeight > 0 ? `<rect class="forecast-danger-zone" x="${padLeft}" y="${thresholdY}" width="${chartW}" height="${dangerHeight}"></rect>` : ''}
                <line class="forecast-threshold-line" x1="${padLeft}" y1="${thresholdY}" x2="${width - padRight}" y2="${thresholdY}"></line>
                <polyline class="forecast-line" points="${pastCoords.join(' ')}"></polyline>
                <polyline class="forecast-line forecast-line-projected" points="${futureCoords.join(' ')}"></polyline>
                ${markers}
                ${xLabels}
            </svg>
            ${callouts}
        `;
        const columns = rows.map((r, i) => ({
            x: xAt(i),
            label: window.BWDate.formatDate(r.date) + (r.projected ? ' (projected)' : ''),
            series: [{ name: 'Balance', value: r.balanceCents, y: yAt(r.balanceCents), colorClass: 'forecast-line', formattedValue: window.BWMoney.formatCents(r.balanceCents) }]
        }));
        return { html, columns, bounds: { xLeft: padLeft, xRight: width - padRight, yTop: padTop, yBottom: padTop + chartH } };
    }

    // Donut chart of spending by category. Two modes:
    // - No selection configured (selectedCategoryIds empty/absent): capped
    //   at the top N (5 or 10, per-widget `topN`) categories plus an
    //   "Other" bucket for the rest (dataviz guidance: pie/donut only reads
    //   at a glance up to ~6-10 segments; past that, adjacent slices blur
    //   and it stops being legible as anything more precise than "roughly
    //   even" or "roughly nothing" — 10 is already pushing it, hence
    //   capping the option there rather than offering more).
    // - Selection configured: only those categories get their own slice —
    //   everything else (unselected categories + uncategorized) folds into
    //   "Other". A selected category no longer in the returned rows (e.g.
    //   since deleted) is silently dropped rather than shown as a
    //   placeholder slice.
    // Both modes order slices largest-to-smallest by spend, with "Other"
    // always last regardless of its size, and drop any slice that rounds
    // to 0% of the total — a sliver with no visible arc and "$0.00 (0%)"
    // in the legend isn't informative, just clutter.
    // Legend is mandatory here (≥2 series), and doubles as exact figures —
    // the donut itself is deliberately just the at-a-glance shape, with a
    // per-slice <title> for hover detail.
    function buildCategoryPieSvg(rows, selectedCategoryIds, topN) {
        const spendingRows = rows
            .filter(r => r.totalCents < 0)
            .map(r => ({
                key: r.category ? String(r.category.id) : 'uncategorized',
                label: r.category ? r.category.name : 'Uncategorized',
                value: Math.abs(r.totalCents)
            }));
        if (spendingRows.length === 0) return '<div class="empty-state">No spending in this range.</div>';

        let slices;
        if (selectedCategoryIds && selectedCategoryIds.length) {
            const selectedSet = new Set(selectedCategoryIds.map(String));
            const byKey = new Map(spendingRows.map(r => [r.key, r]));
            const selected = selectedCategoryIds.map(String).filter((id, i, arr) => arr.indexOf(id) === i)
                .map(id => byKey.get(id))
                .filter(Boolean)
                .sort((a, b) => b.value - a.value);
            const otherValue = spendingRows.filter(r => !selectedSet.has(r.key)).reduce((sum, r) => sum + r.value, 0);
            slices = otherValue > 0 ? [...selected, { key: 'other', label: 'Other', value: otherValue, isOther: true }] : selected;
        } else {
            spendingRows.sort((a, b) => b.value - a.value);
            const maxSlices = topN === 10 ? 10 : 5;
            const top = spendingRows.slice(0, maxSlices);
            const otherValue = spendingRows.slice(maxSlices).reduce((sum, r) => sum + r.value, 0);
            slices = otherValue > 0 ? [...top, { key: 'other', label: 'Other', value: otherValue, isOther: true }] : top;
        }
        let total = slices.reduce((sum, s) => sum + s.value, 0);
        if (total === 0) return '<div class="empty-state">No spending in the selected categories for this range.</div>';
        slices = slices.filter(s => Math.round((s.value / total) * 100) > 0);
        total = slices.reduce((sum, s) => sum + s.value, 0);

        const size = 160, cx = size / 2, cy = size / 2, r = 70, innerR = 42;
        let angle = -Math.PI / 2; // start at 12 o'clock

        const paths = slices.map((s) => {
            const fraction = s.value / total;
            const startAngle = angle;
            const endAngle = angle + fraction * Math.PI * 2;
            angle = endAngle;
            // A full-circle single slice (100% in one category) has no arc
            // to sweep — nudge just short of a full turn so the arc command
            // still renders a (near-)complete ring instead of degenerating.
            const sweep = Math.min(endAngle - startAngle, Math.PI * 2 - 0.001);
            const largeArc = sweep > Math.PI ? 1 : 0;
            const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
            const x2 = cx + r * Math.cos(startAngle + sweep), y2 = cy + r * Math.sin(startAngle + sweep);
            const ix1 = cx + innerR * Math.cos(startAngle), iy1 = cy + innerR * Math.sin(startAngle);
            const ix2 = cx + innerR * Math.cos(startAngle + sweep), iy2 = cy + innerR * Math.sin(startAngle + sweep);
            const colorClass = s.isOther ? 'chart-cat-other' : `chart-cat-${categoryColorSlot(s.key)}`;
            const pct = Math.round(fraction * 100);
            const d = `M ${x1},${y1} A ${r},${r} 0 ${largeArc} 1 ${x2},${y2} L ${ix2},${iy2} A ${innerR},${innerR} 0 ${largeArc} 0 ${ix1},${iy1} Z`;
            return `<path class="pie-slice ${colorClass}" d="${d}"><title>${escapeHtml(s.label)}: ${window.BWMoney.formatCents(s.value)} (${pct}%)</title></path>`;
        }).join('');

        const legend = slices.map((s) => {
            const colorClass = s.isOther ? 'chart-cat-other' : `chart-cat-${categoryColorSlot(s.key)}`;
            const pct = Math.round((s.value / total) * 100);
            return `
                <div class="pie-legend-row">
                    <span class="pie-legend-swatch ${colorClass}"></span>
                    <span class="pie-legend-label">${escapeHtml(s.label)}</span>
                    <span class="pie-legend-value">${window.BWMoney.formatCents(s.value)} (${pct}%)</span>
                </div>
            `;
        }).join('');

        return `
            <div class="pie-chart-layout">
                <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Spending by category">
                    ${paths}
                    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" class="pie-center-label">${window.BWMoney.formatCents(total)}</text>
                </svg>
                <div class="pie-legend">${legend}</div>
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
            const chartEl = div.querySelector('.widget-chart');
            const { html, columns, bounds } = buildSparklineSvg(rows.map(r => ({ label: r.month, value: r.netWorthCents })));
            chartEl.innerHTML = html;
            // Deferred — the hover layer needs real layout (getBoundingClientRect),
            // so this can't run until AFTER renderWidgets() appends the div to
            // the live DOM (buildWidget() itself only builds detached nodes).
            if (columns.length) div.attachHover = () => window.BWChartHover.attach(chartEl.querySelector('svg'), chartEl, columns, bounds);
            return div;
        }

        if (type === 'cashFlow') {
            div.classList.add('widget-wide');
            const { rows } = await window.BWApi.apiFetch(`/api/reports/income-vs-expense?${rangeQuery(trailingRange(trendMonths(dateRangePreset)))}`);
            div.innerHTML = `<div class="stat-label">${handle}Cash Flow</div><div class="widget-chart"></div>`;
            const chartEl = div.querySelector('.widget-chart');
            const { html, columns, bounds } = buildCashFlowSvg(rows);
            chartEl.innerHTML = html;
            if (columns.length) div.attachHover = () => window.BWChartHover.attach(chartEl.querySelector('svg'), chartEl, columns, bounds);
            return div;
        }

        if (type === 'forecast') {
            div.classList.add('widget-full');
            const params = new URLSearchParams({
                account: accountId || '',
                pastAmount: widget.pastAmount,
                pastUnit: widget.pastUnit,
                futureAmount: widget.futureAmount,
                futureUnit: widget.futureUnit
            });
            const { rows } = await window.BWApi.apiFetch(`/api/reports/forecast?${params.toString()}`);
            div.innerHTML = `<div class="stat-label">${handle}Forecast — ${accountLabel(accountId)}</div><div class="widget-chart"></div>`;
            const chartEl = div.querySelector('.widget-chart');
            const { html, columns, bounds } = buildForecastSvg(rows, widget.thresholdCents);
            chartEl.innerHTML = html;
            if (columns.length) div.attachHover = () => window.BWChartHover.attach(chartEl.querySelector('svg'), chartEl, columns, bounds);
            return div;
        }

        if (type === 'accountBalance') {
            div.classList.add('widget-balance');
            const account = accounts.find(a => a.id === accountId);
            if (!account) {
                // The account was closed or its share was revoked since
                // this widget was added — same defensive handling as a
                // removed widget type, rather than crashing the whole grid.
                div.innerHTML = `<div class="stat-label">${handle}Account Balance</div><div class="stat-value muted">Unknown account</div>`;
                return div;
            }
            const balanceClass = account.balanceCents < 0 ? 'money-negative' : 'money-positive';
            div.classList.add('widget-clickable');
            div.title = `Open ${account.name}'s register`;
            div.innerHTML = `<div class="stat-label">${handle}${account.name}</div><div class="stat-value ${balanceClass}">${window.BWMoney.formatCents(account.balanceCents)}</div>`;
            // Ignore clicks on the drag handle itself — grabbing it to
            // reorder shouldn't also navigate away. A genuine native drag
            // doesn't fire a click afterward, so this only needs to guard
            // against the handle, not against drag-in-progress.
            div.addEventListener('click', (e) => {
                if (e.target.closest('.drag-handle')) return;
                window.location.href = `/accounts/${accountId}`;
            });
            return div;
        }

        if (type === 'spendingPie') {
            div.classList.add('widget-wide');
            const { rows } = await window.BWApi.apiFetch(`/api/reports/spending-by-category?${rangeQuery(periodRange(dateRangePreset))}`);
            div.innerHTML = `<div class="stat-label">${handle}Spending by Category</div><div class="widget-chart"></div>`;
            div.querySelector('.widget-chart').innerHTML = buildCategoryPieSvg(rows, widget.selectedCategoryIds, widget.pieTopN);
            return div;
        }

        return null;
    }

    async function renderWidgets() {
        const elements = await Promise.all(currentWidgets.map(buildWidget));
        widgetsContainer.innerHTML = '';
        elements.forEach(el => { if (el) widgetsContainer.appendChild(el); });
        // Chart widgets stash a pending hover-attach callback on their own
        // div (see buildWidget's netWorth/cashFlow/forecast cases) — run
        // those now that every element actually has real layout.
        elements.forEach(el => { if (el && el.attachHover) el.attachHover(); });
    }

    // Attached once (not from inside renderWidgets, which reruns on every
    // month switch/preset change/save) — makeSortable adds its listeners
    // straight to `widgetsContainer` itself, a persistent element that only
    // ever gets its CHILDREN replaced (see renderWidgets' innerHTML reset),
    // never the container. Calling it again on every render just kept
    // stacking a fresh, independent set of drag/drop listeners on top of
    // every set from every prior render — each drop then fired ALL of them,
    // each racing its own duplicate PUT to /api/auth/preferences. Whichever
    // one happened to land last (not necessarily the one with the correct
    // final order, since network timing isn't guaranteed) silently won,
    // which is what made a reorder look saved right up until you switched
    // months/pages and reloaded from the server's actual (wrong) state.
    window.BWDragReorder.makeSortable(widgetsContainer, async (ids) => {
        // ids are just the dragged data-drag-id (widget.id) strings — map
        // back to the full instance objects in their new order.
        currentWidgets = ids.map(id => currentWidgets.find(w => w.id === id)).filter(Boolean);
        await saveDashboardPrefs();
    });

    // ── Customize modal ──────────────────────────────────────────────
    // Edits happen on a draft copy so Cancel can discard them cleanly —
    // otherwise an add/remove in the "totals" list would already have
    // mutated currentWidgets before Save is ever clicked.
    const customizeOverlay = document.getElementById('customize-dashboard-overlay');
    const singletonChecklist = document.getElementById('singleton-widget-checklist');
    const spendingPieCategoriesPanel = document.getElementById('spendingpie-categories-panel');
    const spendingPieCategoriesList = document.getElementById('spendingpie-categories-list');
    const spendingPieSelectAllBtn = document.getElementById('spendingpie-select-all-btn');
    const spendingPieDeselectAllBtn = document.getElementById('spendingpie-deselect-all-btn');
    const spendingPieTopNSelect = document.getElementById('spendingpie-topn-select');
    const totalsListEl = document.getElementById('totals-widget-list');
    const addWidgetType = document.getElementById('add-widget-type');
    const addWidgetAccount = document.getElementById('add-widget-account');
    const addWidgetBtn = document.getElementById('add-widget-btn');
    const cancelWidgetEditBtn = document.getElementById('cancel-widget-edit-btn');
    const forecastListEl = document.getElementById('forecast-widget-list');
    const addForecastAccount = document.getElementById('add-forecast-account');
    const addForecastPastAmount = document.getElementById('add-forecast-past-amount');
    const addForecastPastUnit = document.getElementById('add-forecast-past-unit');
    const addForecastFutureAmount = document.getElementById('add-forecast-future-amount');
    const addForecastFutureUnit = document.getElementById('add-forecast-future-unit');
    const addForecastThreshold = document.getElementById('add-forecast-threshold');
    const addForecastBtn = document.getElementById('add-forecast-btn');
    const cancelForecastEditBtn = document.getElementById('cancel-forecast-edit-btn');
    const balanceListEl = document.getElementById('balance-widget-list');
    const addBalanceAccount = document.getElementById('add-balance-account');
    const addBalanceBtn = document.getElementById('add-balance-btn');
    const cancelBalanceEditBtn = document.getElementById('cancel-balance-edit-btn');
    const alignSelect = document.getElementById('widget-align');
    let draftWidgets = [];
    // Tracks the widget instance id being edited in each of the three
    // "add" forms below (null = plain add mode) — set by the row's ✎
    // button, cleared by Cancel, a successful Update, or removing the row
    // being edited out from under it.
    let editingTotalsId = null;
    let editingForecastId = null;
    let editingBalanceId = null;

    function buildSingletonChecklist() {
        singletonChecklist.innerHTML = SINGLETON_WIDGETS.map(w => `
            <div class="checkbox-row form-group">
                <input type="checkbox" id="widget-check-${w.type}" data-widget-type="${w.type}" ${draftWidgets.some(dw => dw.type === w.type) ? 'checked' : ''}>
                <label for="widget-check-${w.type}">${w.label}</label>
                ${w.type === 'spendingPie' ? '<button type="button" class="icon-btn" id="spendingpie-categories-btn" title="Choose categories" style="border:none;background:none;cursor:pointer;">⚙</button>' : ''}
            </div>
        `).join('');
        document.getElementById('spendingpie-categories-btn').addEventListener('click', () => {
            spendingPieCategoriesPanel.hidden = !spendingPieCategoriesPanel.hidden;
            if (!spendingPieCategoriesPanel.hidden) buildSpendingPieCategoriesList();
        });
    }

    // Selection for the spendingPie widget's category picker — kept
    // separate from draftWidgets while the modal is open (rather than
    // mutating a widget entry directly) since the widget might not even be
    // checked/present in draftWidgets yet while its categories are being
    // configured; save-widgets-btn below writes this into the final entry.
    let spendingPieCategoryIds = [];

    function buildSpendingPieCategoriesList() {
        const sorted = [...categories].filter(c => !c.archived).sort((a, b) => a.name.localeCompare(b.name));
        if (sorted.length === 0) {
            spendingPieCategoriesList.innerHTML = '<p class="muted" style="font-size:0.85rem;">No categories yet.</p>';
            return;
        }
        spendingPieCategoriesList.innerHTML = sorted.map(c => `
            <div class="checkbox-row form-group">
                <input type="checkbox" id="spendingpie-cat-${c.id}" data-category-id="${c.id}" ${spendingPieCategoryIds.includes(c.id) ? 'checked' : ''}>
                <label for="spendingpie-cat-${c.id}">${c.name}</label>
            </div>
        `).join('');
        spendingPieCategoriesList.querySelectorAll('[data-category-id]').forEach((cb) => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.categoryId;
                spendingPieCategoryIds = cb.checked
                    ? [...spendingPieCategoryIds, id]
                    : spendingPieCategoryIds.filter(x => x !== id);
            });
        });
    }

    spendingPieSelectAllBtn.addEventListener('click', () => {
        spendingPieCategoryIds = categories.filter(c => !c.archived).map(c => c.id);
        buildSpendingPieCategoriesList();
    });
    spendingPieDeselectAllBtn.addEventListener('click', () => {
        spendingPieCategoryIds = [];
        buildSpendingPieCategoriesList();
    });

    function buildTotalsList() {
        const instances = draftWidgets.filter(w => TOTALS_WIDGETS.some(t => t.type === w.type));
        if (instances.length === 0) {
            totalsListEl.innerHTML = '<p class="muted" style="font-size:0.85rem;">None added yet.</p>';
            return;
        }
        totalsListEl.innerHTML = instances.map(w => `
            <div class="widget-instance-row">
                <span>${WIDGET_LABELS[w.type]} — ${accountLabel(w.accountId)}</span>
                <span class="row-actions">
                    <button type="button" class="icon-btn" data-edit-instance="${w.id}" title="Edit" style="border:none;background:none;cursor:pointer;">✎</button>
                    <button type="button" class="icon-btn money-negative" data-remove-instance="${w.id}" title="Remove" style="border:none;background:none;cursor:pointer;">🗑</button>
                </span>
            </div>
        `).join('');
        totalsListEl.querySelectorAll('[data-edit-instance]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const w = draftWidgets.find(w => w.id === btn.dataset.editInstance);
                if (!w) return;
                editingTotalsId = w.id;
                addWidgetType.value = w.type;
                addWidgetAccount.value = w.accountId || '';
                addWidgetBtn.textContent = 'Update';
                cancelWidgetEditBtn.hidden = false;
            });
        });
        totalsListEl.querySelectorAll('[data-remove-instance]').forEach((btn) => {
            btn.addEventListener('click', () => {
                draftWidgets = draftWidgets.filter(w => w.id !== btn.dataset.removeInstance);
                if (editingTotalsId === btn.dataset.removeInstance) resetTotalsEdit();
                buildTotalsList();
            });
        });
    }

    function resetTotalsEdit() {
        editingTotalsId = null;
        addWidgetType.value = 'summary';
        addWidgetAccount.value = '';
        addWidgetBtn.textContent = '+ Add';
        cancelWidgetEditBtn.hidden = true;
    }

    function populateAccountSelect() {
        addWidgetAccount.innerHTML = '<option value="">All accounts</option>' +
            accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    }

    // No "All accounts" option here — a forecast is always tied to exactly
    // one account (services/reports/forecast.js requires it).
    function populateForecastAccountSelect() {
        addForecastAccount.innerHTML = accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    }

    function forecastSummary(w) {
        return `Past ${w.pastAmount} ${w.pastUnit}, future ${w.futureAmount} ${w.futureUnit}, below ${window.BWMoney.formatCents(w.thresholdCents)}`;
    }

    function buildForecastList() {
        const instances = draftWidgets.filter(w => w.type === 'forecast');
        if (instances.length === 0) {
            forecastListEl.innerHTML = '<p class="muted" style="font-size:0.85rem;">None added yet.</p>';
            return;
        }
        forecastListEl.innerHTML = instances.map(w => `
            <div class="widget-instance-row">
                <span>${accountLabel(w.accountId)} <span class="muted" style="font-size:0.8rem;">— ${forecastSummary(w)}</span></span>
                <span class="row-actions">
                    <button type="button" class="icon-btn" data-edit-forecast="${w.id}" title="Edit" style="border:none;background:none;cursor:pointer;">✎</button>
                    <button type="button" class="icon-btn money-negative" data-remove-forecast="${w.id}" title="Remove" style="border:none;background:none;cursor:pointer;">🗑</button>
                </span>
            </div>
        `).join('');
        forecastListEl.querySelectorAll('[data-edit-forecast]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const w = draftWidgets.find(w => w.id === btn.dataset.editForecast);
                if (!w) return;
                editingForecastId = w.id;
                addForecastAccount.value = w.accountId;
                addForecastPastAmount.value = w.pastAmount;
                addForecastPastUnit.value = w.pastUnit;
                addForecastFutureAmount.value = w.futureAmount;
                addForecastFutureUnit.value = w.futureUnit;
                addForecastThreshold.value = (w.thresholdCents / 100).toFixed(2);
                addForecastBtn.textContent = 'Update';
                cancelForecastEditBtn.hidden = false;
            });
        });
        forecastListEl.querySelectorAll('[data-remove-forecast]').forEach((btn) => {
            btn.addEventListener('click', () => {
                draftWidgets = draftWidgets.filter(w => w.id !== btn.dataset.removeForecast);
                if (editingForecastId === btn.dataset.removeForecast) resetForecastEdit();
                buildForecastList();
            });
        });
    }

    function resetForecastEdit() {
        editingForecastId = null;
        addForecastPastAmount.value = '10';
        addForecastPastUnit.value = 'days';
        addForecastFutureAmount.value = '6';
        addForecastFutureUnit.value = 'months';
        addForecastThreshold.value = '1000.00';
        addForecastBtn.textContent = '+ Add';
        cancelForecastEditBtn.hidden = true;
    }

    // No "All accounts" option here either — same reasoning as
    // populateForecastAccountSelect, a balance is always one account's.
    function populateBalanceAccountSelect() {
        addBalanceAccount.innerHTML = accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    }

    function buildBalanceList() {
        const instances = draftWidgets.filter(w => w.type === 'accountBalance');
        if (instances.length === 0) {
            balanceListEl.innerHTML = '<p class="muted" style="font-size:0.85rem;">None added yet.</p>';
            return;
        }
        balanceListEl.innerHTML = instances.map(w => `
            <div class="widget-instance-row">
                <span>${accountLabel(w.accountId)}</span>
                <span class="row-actions">
                    <button type="button" class="icon-btn" data-edit-balance="${w.id}" title="Edit" style="border:none;background:none;cursor:pointer;">✎</button>
                    <button type="button" class="icon-btn money-negative" data-remove-balance="${w.id}" title="Remove" style="border:none;background:none;cursor:pointer;">🗑</button>
                </span>
            </div>
        `).join('');
        balanceListEl.querySelectorAll('[data-edit-balance]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const w = draftWidgets.find(w => w.id === btn.dataset.editBalance);
                if (!w) return;
                editingBalanceId = w.id;
                addBalanceAccount.value = w.accountId;
                addBalanceBtn.textContent = 'Update';
                cancelBalanceEditBtn.hidden = false;
            });
        });
        balanceListEl.querySelectorAll('[data-remove-balance]').forEach((btn) => {
            btn.addEventListener('click', () => {
                draftWidgets = draftWidgets.filter(w => w.id !== btn.dataset.removeBalance);
                if (editingBalanceId === btn.dataset.removeBalance) resetBalanceEdit();
                buildBalanceList();
            });
        });
    }

    function resetBalanceEdit() {
        editingBalanceId = null;
        addBalanceBtn.textContent = '+ Add';
        cancelBalanceEditBtn.hidden = true;
    }

    document.getElementById('customize-dashboard-btn').addEventListener('click', () => {
        draftWidgets = currentWidgets.map(w => ({ ...w }));
        resetTotalsEdit();
        resetForecastEdit();
        resetBalanceEdit();
        const existingPie = draftWidgets.find(w => w.type === 'spendingPie');
        spendingPieCategoryIds = existingPie && existingPie.selectedCategoryIds ? existingPie.selectedCategoryIds.map(String) : [];
        spendingPieTopNSelect.value = existingPie && existingPie.pieTopN === 10 ? '10' : '5';
        spendingPieCategoriesPanel.hidden = true;
        buildSingletonChecklist();
        populateAccountSelect();
        populateForecastAccountSelect();
        populateBalanceAccountSelect();
        buildTotalsList();
        buildForecastList();
        buildBalanceList();
        alignSelect.value = align;
        customizeOverlay.hidden = false;
    });
    document.getElementById('cancel-widget-edit-btn').addEventListener('click', resetTotalsEdit);
    document.getElementById('cancel-forecast-edit-btn').addEventListener('click', resetForecastEdit);
    document.getElementById('cancel-balance-edit-btn').addEventListener('click', resetBalanceEdit);
    document.getElementById('cancel-widgets-btn').addEventListener('click', () => { customizeOverlay.hidden = true; });
    customizeOverlay.addEventListener('click', (e) => { if (e.target === customizeOverlay) customizeOverlay.hidden = true; });

    addWidgetBtn.addEventListener('click', () => {
        const type = addWidgetType.value;
        const accountId = addWidgetAccount.value || null;
        if (editingTotalsId) {
            const w = draftWidgets.find(w => w.id === editingTotalsId);
            if (w) { w.type = type; w.accountId = accountId; }
        } else {
            draftWidgets.push({ id: makeWidgetId(type), type, accountId });
        }
        resetTotalsEdit();
        buildTotalsList();
    });

    addForecastBtn.addEventListener('click', () => {
        const accountId = addForecastAccount.value;
        if (!accountId) return;
        const values = {
            accountId,
            pastAmount: Number(addForecastPastAmount.value) || 10,
            pastUnit: addForecastPastUnit.value,
            futureAmount: Number(addForecastFutureAmount.value) || 6,
            futureUnit: addForecastFutureUnit.value,
            thresholdCents: window.BWMoney.toCents(addForecastThreshold.value || 0)
        };
        if (editingForecastId) {
            const w = draftWidgets.find(w => w.id === editingForecastId);
            if (w) Object.assign(w, values);
        } else {
            draftWidgets.push({ id: makeWidgetId('forecast'), type: 'forecast', ...values });
        }
        resetForecastEdit();
        buildForecastList();
    });

    addBalanceBtn.addEventListener('click', () => {
        const accountId = addBalanceAccount.value;
        if (!accountId) return;
        if (editingBalanceId) {
            const w = draftWidgets.find(w => w.id === editingBalanceId);
            if (w) w.accountId = accountId;
        } else {
            draftWidgets.push({ id: makeWidgetId('accountBalance'), type: 'accountBalance', accountId });
        }
        resetBalanceEdit();
        buildBalanceList();
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
        const pieWidget = widgets.find(w => w.type === 'spendingPie');
        if (pieWidget) {
            pieWidget.selectedCategoryIds = spendingPieCategoryIds.slice();
            pieWidget.pieTopN = spendingPieTopNSelect.value === '10' ? 10 : 5;
        }

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
            await loadCategories();
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
