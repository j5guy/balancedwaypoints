(function () {
    const page = document.querySelector('.page-register');
    if (!page) return;
    const accountId = page.dataset.accountId;
    const errorBox = document.getElementById('register-error');

    let accounts = [];
    let categories = [];
    let categoryGroups = [];
    let payees = [];
    // Set from the account itself in loadReferenceData — null unless this
    // account is linked to a SimpleFIN connection (see models/account.js),
    // in which case it powers the "Sync Now" button next to Import above.
    let simplefinConnectionId = null;
    let editingId = null;
    let currentBalanceCents = 0;
    let transactionsById = new Map();
    let preferences = null;
    // Bulk category selection — ids of currently-checked rows. Cleared on
    // every loadTransactions() reload rather than tracked across reloads,
    // since the set of rendered rows (and which are even selectable) can
    // change with the sort/filter/history-window preferences.
    let selectedIds = new Set();

    // Live per-column register filter (see the "⌕" row in accounts/show.ejs,
    // just below the quick-add row). Purely client-side over whatever's
    // already loaded — typing never re-fetches, it just re-renders the
    // cached transactions/balances/upcoming rows below (see
    // renderRegisterRows). Balances are computed once from the FULL
    // unfiltered list (loadTransactions) and just looked up per row here, so
    // filtering never shifts a shown balance away from its real value.
    let filterState = { date: '', payee: '', category: '', notes: '', tags: '', amount: '' };
    let currentTransactions = [];
    let currentBalanceById = new Map();
    let currentUpcomingRows = [];
    // Collapsed by default — the register's own row list stays focused on
    // actual transactions, while the Forecast chart above (a separate fetch
    // in loadForecastChart, not fed by these rows) keeps showing the
    // projection regardless of this. Session-only, not persisted — reset to
    // collapsed on every fresh page load.
    let upcomingCollapsed = true;
    // 'owner' unless this register belongs to an account someone else
    // shared with us (see accountsController.js's serialize) — gates every
    // write control below. Every reference-data fetch always carries
    // ?account=<accountId> too, which is a harmless no-op when it resolves
    // to yourself (see services/authz/actingOwner.js's resolveActingOwner).
    let accountRole = 'owner';
    let accountType = 'checking';
    // Set from the account itself (see loadReferenceData) rather than a
    // register/user preference — same idea as the Dashboard's per-widget
    // forecast threshold, just one persistent value per account (see
    // models/account.js) instead of one per widget instance. null = no
    // warning threshold configured — the chart just shows the balance
    // line, no danger zone/crossing warnings.
    let forecastThresholdCents = null;
    let forecastThresholdColor = '#B5433A';
    // Credit/loan/other accounts routinely sit negative (that's debt, not
    // trouble) — a low-balance warning doesn't mean anything there, so it's
    // suppressed regardless of whether a threshold is configured, same as
    // if none were set at all.
    const SUPPRESS_WARNING_TYPES = ['credit', 'loan', 'other'];

    const COLUMN_LABELS = {
        date: 'Date', payee: 'Payee', category: 'Category', notes: 'Notes',
        tags: 'Tags', amount: 'Amount', balance: 'Balance', cleared: 'Cleared'
    };
    const DEFAULT_COLUMN_ORDER = ['date', 'payee', 'category', 'notes', 'tags', 'amount', 'balance', 'cleared'];
    const DEFAULT_PREFERENCES = {
        registerSort: 'newest',
        registerMask: { amount: false, balance: false },
        registerColumns: { date: true, payee: true, category: true, notes: true, tags: true, amount: true, balance: true, cleared: true },
        registerColumnOrder: DEFAULT_COLUMN_ORDER.slice(),
        upcomingSchedules: { enabled: false, amount: 14, unit: 'days' },
        registerHistory: { enabled: false, amount: 3, unit: 'months' },
        badgeColors: { scheduled: null, due: null, autopay: null }
    };

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }
    function clearError() { errorBox.hidden = true; }

    // Only used by the splits editor now — the main category field is a
    // text input + datalist (see resolveCategory) so a new category can be
    // created directly from the transaction form.
    function categoryOptionsHtml() {
        return '<option value="">— none —</option>' + categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }

    // Shared by loadReferenceData (initial load) and the mask toggle
    // (instant re-render, no re-fetch needed since currentBalanceCents is
    // already known).
    function renderAccountBalance() {
        const masked = preferences.registerMask && preferences.registerMask.balance;
        const balEl = document.getElementById('account-balance');
        balEl.textContent = window.BWMoney.formatCents(currentBalanceCents, masked);
        balEl.classList.remove('money-positive', 'money-negative', 'money-masked');
        balEl.classList.add(masked ? 'money-masked' : (currentBalanceCents < 0 ? 'money-negative' : 'money-positive'));
    }

    async function loadReferenceData() {
        // Fetched by id (not the owned-only /api/accounts list) since this
        // register may belong to an account someone else shared with us —
        // GET /api/accounts/:id resolves access via any share role and
        // reports back which one (see accountsController.js's get()).
        const [account, accountsRes, categoriesRes, categoryGroupsRes, payeesRes] = await Promise.all([
            window.BWApi.apiFetch(`/api/accounts/${accountId}`),
            window.BWApi.apiFetch('/api/accounts'),
            window.BWApi.apiFetch(`/api/categories?account=${accountId}`),
            window.BWApi.apiFetch(`/api/category-groups?account=${accountId}`),
            window.BWApi.apiFetch(`/api/payees?account=${accountId}`)
        ]);
        accountRole = account.role;
        accountType = account.type;
        forecastThresholdCents = account.forecastThresholdCents != null ? account.forecastThresholdCents : null;
        forecastThresholdColor = account.forecastThresholdColor || '#B5433A';
        accounts = accountsRes.accounts;
        categories = categoriesRes.categories;
        categoryGroups = categoryGroupsRes.categoryGroups;
        payees = payeesRes.payees;

        document.getElementById('account-name').textContent = account.name;
        currentBalanceCents = account.balanceCents;
        renderAccountBalance();

        simplefinConnectionId = account.simplefinConnection || null;

        document.getElementById('category-options').innerHTML = categories.map(c => `<option value="${c.name}">`).join('');
        document.getElementById('bulk-category-select').innerHTML = '<option value="">— choose category —</option>' +
            categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        const groupOptionsHtml = '<option value="">— pick a group —</option>' +
            categoryGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
        document.getElementById('txn-category-new-group').innerHTML = groupOptionsHtml;
        // Transfers are only offered between your own accounts — a shared
        // account's owner may have other accounts we can't see or transfer
        // to/from (no cross-owner transfers at all, per
        // transactionsController.js's createTransfer), so the transfer
        // option is hidden entirely for a shared register (see
        // applyAccessControls below).
        document.getElementById('txn-transfer-account').innerHTML = accounts
            .filter(a => a.id !== accountId)
            .map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        document.getElementById('payee-options').innerHTML = payees.map(p => `<option value="${p.name}">`).join('');
        applyAccessControls();
    }

    // Hides every write control when we only have read-only access to this
    // account's register — a readwrite share still gets the full editing
    // UI (per the Phase 2 access tiers), just scoped to this one account.
    // Adds a page-level class (.register-readonly, see
    // public/scss/components/_tables.scss) that CSS uses to hide each row's
    // edit/delete buttons and disable click-to-edit cells, since those are
    // generated per-row in transactionRow() rather than being fixed
    // elements this function could grab once.
    function applyAccessControls() {
        const readonly = accountRole === 'readonly';
        const isShared = accountRole !== 'owner';
        document.getElementById('toggle-advanced-form-link').parentElement.style.display = readonly ? 'none' : '';
        document.querySelector('.quick-add-row').style.display = readonly ? 'none' : '';
        document.getElementById('txn-is-transfer').parentElement.style.display = isShared ? 'none' : '';
        // Same reasoning as the "is transfer" checkbox above — #accounts
        // only ever lists accounts you own, so the "transfer to/from"
        // picker would offer nothing usable (and the server would reject a
        // cross-owner pick anyway) while managing a shared account.
        document.getElementById('convert-to-transfer-btn').style.display = isShared ? 'none' : '';
        document.querySelector('.page-register').classList.toggle('register-readonly', readonly);
        document.getElementById('select-all-checkbox').closest('th').style.display = readonly ? 'none' : '';
        if (readonly) document.getElementById('bulk-actions-bar').hidden = true;
        // The Import page's account picker only ever lists accounts you own
        // (see /api/accounts — accountsController.js's list()), so linking
        // there from a shared account's register would just land on the
        // picker showing none of the accounts you meant, silently defaulted
        // to whichever owned account sorts first. Owner-only avoids that
        // dead end rather than trying to teach imports about shared access.
        document.getElementById('import-link').style.display = isShared ? 'none' : '';
        // Same owner-only reasoning as Import above — the SimpleFIN
        // connection belongs to the account's owner, and syncing writes
        // transactions the same way a collaborator can't via a shared
        // register's own write controls.
        document.getElementById('sync-now-btn').hidden = !simplefinConnectionId || isShared;
    }

    // Resolves a typed category name to an id, creating the category (in the
    // group picked in the "new category" select) if it doesn't exist yet —
    // same pattern as resolvePayee/resolveTags below.
    async function resolveCategory(name, groupId) {
        if (!name) return null;
        const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;
        if (!groupId) throw new Error(`"${name}" isn't an existing category — pick a group to create it in`);
        const created = await window.BWApi.apiFetch(`/api/categories?account=${accountId}`, { method: 'POST', body: { name, group: groupId } });
        categories.push(created);
        return created.id;
    }

    // Walks `orderedTransactions` newest-first, seeded from the account's
    // real CURRENT balance and subtracting each transaction's own amount to
    // step to the balance just before it — rather than seeding from the
    // starting balance and walking the other way — so this stays correct
    // even when the register's history is limited to a rolling window (see
    // the registerHistory preference) and the oldest loaded row isn't
    // actually the account's first-ever transaction. Callers decide what
    // "newest-first" means for the input order: for the 'manual' sort mode
    // that's the drag-and-drop DISPLAY order (so dragging a row recalculates
    // every balance between its old and new spot, same as physically
    // re-ordering entries in a paper ledger would); for date-based sort
    // modes it's always by date regardless of how rows are displayed — see
    // loadTransactions' balanceOrder.
    function computeRunningBalances(orderedTransactions) {
        let running = currentBalanceCents;
        const balanceById = new Map();
        for (let i = 0; i < orderedTransactions.length; i++) {
            const t = orderedTransactions[i];
            balanceById.set(t.id, running);
            running -= t.amountCents;
        }
        return balanceById;
    }

    // Re-derives balances from the register's current on-screen row order
    // (after a drag-and-drop reorder) and patches each row's balance cell in
    // place — no re-fetch needed, since a drag already leaves the DOM in the
    // new order (see dragReorder.js's live insertBefore during dragover).
    function refreshBalanceDisplay() {
        const tbody = document.getElementById('register-tbody');
        const rows = [...tbody.querySelectorAll('tr[data-drag-id]')];
        const orderedTransactions = rows.map(tr => transactionsById.get(tr.dataset.dragId)).filter(Boolean);
        const balanceById = computeRunningBalances(orderedTransactions);
        rows.forEach(tr => {
            const t = transactionsById.get(tr.dataset.dragId);
            if (!t) return;
            const cell = tr.querySelector('.js-balance-cell');
            const balanceCents = balanceById.get(t.id);
            const masked = preferences.registerMask && preferences.registerMask.balance;
            cell.textContent = window.BWMoney.formatCents(balanceCents, masked);
            cell.classList.remove('money-positive', 'money-negative', 'money-masked');
            cell.classList.add(masked ? 'money-masked' : (balanceCents < 0 ? 'money-negative' : 'money-positive'));
        });
    }

    function isFiltering() {
        return Object.values(filterState).some(v => v);
    }

    function transactionRow(t, balanceCents) {
        const tr = document.createElement('tr');
        // Dragging works regardless of sort mode — see the reorder handler
        // in init() below, which switches the sort preference to 'manual'
        // the moment a row actually gets dragged, so the new position
        // sticks instead of snapping back to date order on next load.
        // Disabled while a filter narrows the list: dragReorder posts
        // top-to-bottom ids straight from the visible DOM order (see
        // dragReorder.js), and services/database/transactions.js's reorder()
        // renumbers sortOrder purely from that array's length/position — a
        // partial (filtered) list would clobber every hidden row's sortOrder
        // out from under it.
        tr.draggable = accountRole !== 'readonly' && !isFiltering();
        tr.dataset.dragId = t.id;
        const category = t.category ? t.category.name : (t.splits && t.splits.length ? 'Split' : (t.transferAccount ? 'Transfer' : ''));
        // Autopay is denormalized onto the transaction at posting time (see
        // models/transaction.js) — no schedule lookup needed here. When the
        // schedule had a source account, this leg's own transferAccount IS
        // that source (see services/database/transactions.js's
        // createAutopayOccurrence), so it doubles as the "drafted from"
        // account for the tooltip; on the source account's OWN register the
        // draft leg shows this same badge next to its "Transfer" category text.
        const autopayFromName = t.transferAccount ? (accounts.find(a => a.id === t.transferAccount)?.name || null) : null;
        const autopayColor = window.BWBadgeColor.badgeStyle(preferences.badgeColors && preferences.badgeColors.autopay);
        const autopayBadge = t.autopay
            ? ` <span class="badge" style="${autopayColor}" title="Autopay${autopayFromName ? ' — drafted from ' + autopayFromName : ''}">⟳ Autopay</span>`
            : '';
        const maskAmount = preferences.registerMask && preferences.registerMask.amount;
        const maskBalance = preferences.registerMask && preferences.registerMask.balance;
        const amountClass = maskAmount ? 'money-masked' : (t.amountCents < 0 ? 'money-negative' : 'money-positive');
        const balanceClass = maskBalance ? 'money-masked' : (balanceCents < 0 ? 'money-negative' : 'money-positive');
        const isCleared = t.cleared !== 'pending';
        // Bulk category selection is offered for plain transactions only —
        // a transfer has no category at all, and a split transaction's
        // category lives per-split (see startCellEdit's identical guard on
        // the category cell), so both get a disabled, unchecked checkbox
        // rather than being silently skipped by a bulk apply.
        const bulkDisabled = accountRole === 'readonly' || !!t.transferId || (t.splits && t.splits.length > 0);
        const bulkTitle = t.transferId ? "Transfers can't be bulk-edited"
            : (t.splits && t.splits.length ? 'Split transactions must be edited individually' : 'Select for bulk actions');
        tr.innerHTML = `
            <td class="row-select-cell" style="text-align:center;">
                <input type="checkbox" class="row-select-checkbox" data-select-id="${t.id}" title="${bulkTitle}" ${bulkDisabled ? 'disabled' : ''}>
            </td>
            <td class="drag-handle" title="${isFiltering() ? 'Clear filters to reorder' : 'Drag to reorder'}">⠿</td>
            <td class="editable-cell" data-col="date">${window.BWDate.formatDate(t.date)}</td>
            <td class="editable-cell" data-col="payee">${t.payee ? t.payee.name : ''}${autopayBadge}</td>
            <td class="editable-cell" data-col="category">${category}</td>
            <td class="editable-cell" data-col="notes" title="${escapeAttr(t.notes || '')}">${t.notes || ''}</td>
            <td class="editable-cell" data-col="tags">${(t.tags || []).map(tag => `<span class="badge">${tag.name}</span>`).join(' ')}</td>
            <td class="money editable-cell ${amountClass}" data-col="amount">${window.BWMoney.formatCents(t.amountCents, maskAmount)}</td>
            <td class="money js-balance-cell ${balanceClass}" data-col="balance">${window.BWMoney.formatCents(balanceCents, maskBalance)}</td>
            <td data-col="cleared">
                <button type="button" class="cleared-toggle ${isCleared ? 'cleared-toggle-on' : 'cleared-toggle-off'}"
                        data-cleared-toggle title="${isCleared ? 'Cleared — click to mark pending' : 'Pending — click to mark cleared'}">${isCleared ? '✓' : '✕'}</button>
            </td>
            <td class="row-actions">
                <button type="button" class="btn btn-secondary btn-sm icon-btn" data-edit title="Edit">✎</button>
                <button type="button" class="btn btn-danger btn-sm icon-btn" data-delete title="Delete">🗑</button>
            </td>
        `;
        tr.querySelector('[data-edit]').addEventListener('click', () => startEdit(t));
        tr.querySelector('[data-delete]').addEventListener('click', () => deleteTransaction(t.id));
        tr.querySelector('[data-cleared-toggle]').addEventListener('click', () => toggleCleared(t));
        const selectCb = tr.querySelector('.row-select-checkbox');
        if (!bulkDisabled) {
            selectCb.checked = selectedIds.has(t.id);
            selectCb.addEventListener('change', () => {
                if (selectCb.checked) selectedIds.add(t.id); else selectedIds.delete(t.id);
                updateBulkBar();
            });
        }
        tr.querySelectorAll('.editable-cell').forEach((td) => {
            td.addEventListener('click', () => startCellEdit(tr, td, t));
        });
        applyColumnOrder(tr, normalizedColumnOrder());
        return tr;
    }

    // ── Click-to-edit register cells ─────────────────────────────────
    // Click any editable cell (date/payee/category/notes/tags/amount) to
    // turn it into an inline input, spreadsheet-style — commits on Enter or
    // blur, cancels on Escape. Payee/category reuse the same #payee-options
    // / #category-options <datalist> the quick-add row and full form use,
    // for live suggestions from past entries.
    let editingCell = null;

    // Field values land in an HTML attribute (value="...") below, unlike
    // the rest of this file which sets .value as a DOM property — a stray
    // `"` in a note or payee name (plausible from a CSV import) could
    // otherwise break out of the attribute and inject markup.
    function escapeAttr(str) {
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function cellInputHtml(col, t) {
        switch (col) {
            case 'date': return `<input type="date" value="${window.BWDate.toDateInputValue(t.date)}">`;
            case 'payee': return `<input type="text" list="payee-options" value="${escapeAttr(t.payee ? t.payee.name : '')}">`;
            case 'category': return `<input type="text" list="category-options" value="${escapeAttr(t.category ? t.category.name : '')}">`;
            case 'notes': return `<input type="text" value="${escapeAttr(t.notes || '')}">`;
            case 'tags': return `<input type="text" value="${escapeAttr((t.tags || []).map(tag => tag.name).join(', '))}">`;
            case 'amount': return `<input type="number" step="0.01" value="${(t.amountCents / 100).toFixed(2)}">`;
            default: return null;
        }
    }

    // Resolves the input's raw value to the partial PUT body for this
    // column — same name-to-id resolution (creating a payee/tag if it's
    // new) the full form and quick-add row use. Category is deliberately
    // NOT auto-created here — there's no room in a single cell to also pick
    // a category group, so an unrecognized name throws (same message
    // resolveCategory always gives), same as if you'd left the group picker
    // blank in the full form.
    async function resolveCellValue(col, rawValue) {
        switch (col) {
            case 'date': {
                if (!rawValue) throw new Error('Date is required');
                return { date: rawValue };
            }
            case 'payee': return { payee: await resolvePayee(rawValue.trim()) };
            case 'category': return { category: await resolveCategory(rawValue.trim(), null) };
            case 'notes': return { notes: rawValue };
            case 'tags': return { tags: await resolveTags(rawValue) };
            case 'amount': {
                const amountCents = window.BWMoney.toCents(rawValue || 0);
                if (!amountCents) throw new Error('Amount is required');
                return { amountCents };
            }
            default: return {};
        }
    }

    function startCellEdit(tr, td, t) {
        if (editingCell) return;
        if (accountRole === 'readonly') return;
        if (t.transferId) {
            alert("Transfers can't be edited directly — delete and recreate the transfer instead.");
            return;
        }
        const col = td.dataset.col;
        if (col === 'category' && t.splits && t.splits.length) {
            alert('This transaction uses split categories — use the full form (✎) to edit them.');
            return;
        }
        const html = cellInputHtml(col, t);
        if (!html) return;

        const originalHtml = td.innerHTML;
        // Dragging is only wired up in manual sort mode (see transactionRow),
        // but an ancestor's draggable="true" still intercepts mousedown
        // inside a plain text input and breaks click-to-place-cursor/select —
        // suspend it for the duration of this edit.
        const wasDraggable = tr.draggable;
        tr.draggable = false;
        td.innerHTML = html;
        const input = td.querySelector('input');
        input.focus();
        if (input.type !== 'date') input.select();

        // Clears editingCell (so the blur commit() fires below can't re-enter)
        // BEFORE touching the DOM — replacing td's innerHTML destroys the
        // still-focused input, which fires a synchronous blur, which would
        // otherwise re-invoke commit() with editingCell still truthy.
        function exit() {
            editingCell = null;
            tr.draggable = wasDraggable;
        }
        function cancel() {
            if (!editingCell) return;
            exit();
            td.innerHTML = originalHtml;
        }
        async function commit() {
            if (!editingCell) return;
            const rawValue = input.value;
            try {
                const body = await resolveCellValue(col, rawValue);
                exit(); // resolveCellValue's own network calls shouldn't re-enter commit/cancel
                await window.BWApi.apiFetch(`/api/transactions/${t.id}`, { method: 'PUT', body });
                await loadReferenceData();
                await loadTransactions();
            } catch (err) {
                exit();
                td.innerHTML = originalHtml;
                showError(err);
            }
        }

        editingCell = { cancel, commit };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', () => commit());
    }

    // Cleared is binary in this UI (a checkmark or an x) — toggling never
    // sets 'reconciled', only flips between 'pending' and 'cleared'. Updates
    // the button in place rather than reloading the whole register.
    async function toggleCleared(t) {
        if (accountRole === 'readonly') return;
        const next = t.cleared === 'pending' ? 'cleared' : 'pending';
        try {
            const updated = await window.BWApi.apiFetch(`/api/transactions/${t.id}`, { method: 'PUT', body: { cleared: next } });
            t.cleared = updated.cleared;
            const btn = document.querySelector(`tr[data-drag-id="${t.id}"] [data-cleared-toggle]`);
            const isCleared = t.cleared !== 'pending';
            btn.textContent = isCleared ? '✓' : '✕';
            btn.title = isCleared ? 'Cleared — click to mark pending' : 'Pending — click to mark cleared';
            btn.classList.toggle('cleared-toggle-on', isCleared);
            btn.classList.toggle('cleared-toggle-off', !isCleared);
        } catch (err) {
            showError(err);
        }
    }

    // ── Register preferences (columns shown, upcoming schedules) ────
    // Persisted on the logged-in user (see /api/auth/preferences) so they
    // follow the account across devices, not just this browser.
    async function loadPreferences() {
        try {
            preferences = await window.BWApi.apiFetch('/api/auth/preferences');
        } catch (err) {
            preferences = DEFAULT_PREFERENCES;
        }
        applyColumnPreferences();
    }

    // Tolerates a stored order that doesn't exactly match DEFAULT_COLUMN_ORDER
    // (missing a key — e.g. a column added in a later release — or carrying
    // an unknown one) rather than discarding the whole thing: known keys
    // keep the saved order, anything missing gets appended at the end in
    // its default position. controllers/authController.js's
    // sanitizeColumnOrder rejects genuinely malformed input at save time, so
    // this is just a soft self-heal for the one legitimate way a stored
    // order can drift out of sync with the app.
    function normalizedColumnOrder() {
        const stored = Array.isArray(preferences.registerColumnOrder) ? preferences.registerColumnOrder : [];
        const known = stored.filter((key) => DEFAULT_COLUMN_ORDER.includes(key));
        const missing = DEFAULT_COLUMN_ORDER.filter((key) => !known.includes(key));
        return [...known, ...missing];
    }

    // Reorders `parent`'s own [data-col] children (a <colgroup>, a <thead>
    // row, the filter/quick-add rows, or one register <tr>) to match `order`
    // — moving each one, in order, to just before whichever child ISN'T a
    // data column (the trailing row-actions cell/col, always last — see
    // views/accounts/show.ejs's table markup). Leading fixed cells (the
    // checkbox/drag-handle columns) are never touched since they have no
    // data-col to match. Safe to call repeatedly/on an already-ordered
    // parent — inserting an element already in the right place is a no-op.
    function applyColumnOrder(parent, order) {
        if (!parent) return;
        const anchor = parent.lastElementChild;
        order.forEach((key) => {
            const cell = parent.querySelector(`:scope > [data-col="${key}"]`);
            if (cell) parent.insertBefore(cell, anchor);
        });
    }

    function applyColumnPreferences() {
        const table = document.querySelector('.register-table');
        Object.keys(COLUMN_LABELS).forEach((key) => {
            table.classList.toggle(`hide-col-${key}`, !preferences.registerColumns[key]);
        });
        const order = normalizedColumnOrder();
        applyColumnOrder(table.querySelector('colgroup'), order);
        applyColumnOrder(table.querySelector('thead tr'), order);
        applyColumnOrder(document.querySelector('.filter-row'), order);
        applyColumnOrder(document.querySelector('.quick-add-row'), order);
    }

    // `order`/`columns` are passed explicitly (rather than always reading
    // `preferences`) so the "Reset to default" button can render the
    // default layout into this same list without touching saved
    // preferences until "Save settings" is actually clicked — same
    // stage-then-save convention the rest of this panel already follows.
    function renderColumnToggles(order, columns) {
        document.getElementById('column-toggle-list').innerHTML = order.map((key) => `
            <label class="checkbox-row col-toggle-row" draggable="true" data-drag-id="${key}" style="width:auto;">
                <span class="drag-handle" title="Drag to reorder">⠿</span>
                <input type="checkbox" class="col-toggle-checkbox" data-col-key="${key}" ${columns[key] ? 'checked' : ''}>
                ${COLUMN_LABELS[key]}
            </label>
        `).join('');
    }

    // ── Sync Now — pulls new transactions for just this account's own
    // SimpleFIN connection (see controllers/simplefinController.js's
    // syncNow), same endpoint the Bank Sync page's own button hits. Hidden
    // entirely unless this account is actually linked (applyAccessControls
    // above).
    document.getElementById('sync-now-btn').addEventListener('click', async () => {
        if (!simplefinConnectionId) return;
        const btn = document.getElementById('sync-now-btn');
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = '🔄 Syncing…';
        try {
            const result = await window.BWApi.apiFetch(`/api/simplefin/connections/${simplefinConnectionId}/sync`, { method: 'POST' });
            await loadReferenceData();
            await loadTransactions();
            alert(`Synced — imported ${result.created} new transaction${result.created === 1 ? '' : 's'}.${result.warnings.length ? '\n\nWarnings:\n' + result.warnings.join('\n') : ''}`);
        } catch (err) {
            showError(err);
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    });

    // ── Mask amounts/balances (privacy toggle) ───────────────────────
    document.getElementById('toggle-mask-btn').addEventListener('click', () => {
        const panel = document.getElementById('mask-panel');
        if (!panel.hidden) { panel.hidden = true; return; }
        document.getElementById('settings-panel').hidden = true;
        document.getElementById('mask-amount').checked = !!(preferences.registerMask && preferences.registerMask.amount);
        document.getElementById('mask-balance').checked = !!(preferences.registerMask && preferences.registerMask.balance);
        panel.hidden = false;
    });

    async function saveMaskPreference() {
        const registerMask = {
            amount: document.getElementById('mask-amount').checked,
            balance: document.getElementById('mask-balance').checked
        };
        try {
            preferences = await window.BWApi.apiFetch('/api/auth/preferences', { method: 'PUT', body: { registerMask } });
            renderAccountBalance();
            await loadTransactions();
        } catch (err) {
            showError(err);
        }
    }
    document.getElementById('mask-amount').addEventListener('change', saveMaskPreference);
    document.getElementById('mask-balance').addEventListener('change', saveMaskPreference);

    document.getElementById('toggle-settings-btn').addEventListener('click', () => {
        const panel = document.getElementById('settings-panel');
        if (!panel.hidden) { panel.hidden = true; return; }
        document.getElementById('mask-panel').hidden = true;
        renderColumnToggles(normalizedColumnOrder(), preferences.registerColumns);
        document.getElementById('pref-register-sort').value = preferences.registerSort || 'newest';
        document.getElementById('pref-show-upcoming').checked = preferences.upcomingSchedules.enabled;
        document.getElementById('pref-upcoming-amount').value = preferences.upcomingSchedules.amount;
        document.getElementById('pref-upcoming-unit').value = preferences.upcomingSchedules.unit;
        document.getElementById('pref-limit-history').checked = preferences.registerHistory.enabled;
        document.getElementById('pref-history-amount').value = preferences.registerHistory.amount;
        document.getElementById('pref-history-unit').value = preferences.registerHistory.unit;
        panel.hidden = false;
    });
    document.getElementById('cancel-settings-btn').addEventListener('click', () => {
        document.getElementById('settings-panel').hidden = true;
    });
    document.getElementById('reset-columns-btn').addEventListener('click', () => {
        // Only re-renders the toggle list with the default layout — doesn't
        // touch saved preferences (or the live register) until "Save
        // settings" is clicked, same staged-until-save convention as every
        // other field in this panel.
        renderColumnToggles(DEFAULT_COLUMN_ORDER, DEFAULT_PREFERENCES.registerColumns);
    });
    // Wired once against the list container itself (its identity never
    // changes — only its innerHTML is replaced by renderColumnToggles),
    // same reasoning as the register-tbody row reorder in init() below.
    // makeSortable already live-reorders the DOM as you drag, so
    // save-settings-btn's handler can just read the current DOM order at
    // save time — no need to track the reorder callback's own `ids` here.
    window.BWDragReorder.makeSortable(document.getElementById('column-toggle-list'), () => {});
    document.getElementById('save-settings-btn').addEventListener('click', async () => {
        const registerSort = document.getElementById('pref-register-sort').value;
        const registerColumns = {};
        document.querySelectorAll('.col-toggle-checkbox').forEach((cb) => { registerColumns[cb.dataset.colKey] = cb.checked; });
        const registerColumnOrder = [...document.querySelectorAll('#column-toggle-list [data-drag-id]')].map((el) => el.dataset.dragId);
        const upcomingSchedules = {
            enabled: document.getElementById('pref-show-upcoming').checked,
            amount: Math.max(1, Number(document.getElementById('pref-upcoming-amount').value) || 1),
            unit: document.getElementById('pref-upcoming-unit').value
        };
        const registerHistory = {
            enabled: document.getElementById('pref-limit-history').checked,
            amount: Math.max(1, Number(document.getElementById('pref-history-amount').value) || 1),
            unit: document.getElementById('pref-history-unit').value
        };
        try {
            preferences = await window.BWApi.apiFetch('/api/auth/preferences', { method: 'PUT', body: { registerSort, registerColumns, registerColumnOrder, upcomingSchedules, registerHistory } });
            applyColumnPreferences();
            document.getElementById('settings-panel').hidden = true;
            await loadTransactions();
        } catch (err) {
            showError(err);
        }
    });

    // ── Upcoming (scheduled) transaction rows ────────────────────────
    // Read-only preview rows, not real Transactions — no drag id, no
    // edit/delete. Their Balance is a projection (see loadUpcomingRows),
    // marked as an estimate via the cell's title tooltip rather than an
    // inline character, since a "~" read like a stray minus sign at a glance.
    // The "⋯" button opens a modal to edit this occurrence (just this one /
    // this and the next N / this and every one after) or post it into a
    // real Transaction — see openOccurrenceModal below.
    function upcomingRow(occurrence) {
        const s = occurrence.schedule;
        const tr = document.createElement('tr');
        tr.className = 'upcoming-row';
        // Mirrors transactionRow()'s own transfer handling — a transfer
        // schedule has no payee/category (server clears them, see
        // controllers/schedulesController.js), so the Payee column shows
        // the other side of the transfer and Category just reads "Transfer".
        // s.transferAccount is already the CONTEXTUAL counterparty (the
        // other account, whichever register you're viewing this from — see
        // schedulesController.js's serializeOccurrence), with its own
        // direction so the arrow points the right way either side.
        const category = s.category ? s.category.name : (s.splits && s.splits.length ? 'Split' : (s.transferAccount ? 'Transfer' : ''));
        const payeeCell = s.transferAccount ? `${s.transferAccount.direction === 'in' ? '←' : '→'} ${s.transferAccount.name}` : (s.payee ? s.payee.name : '');
        const maskAmount = preferences.registerMask && preferences.registerMask.amount;
        const maskBalance = preferences.registerMask && preferences.registerMask.balance;
        const amountClass = maskAmount ? 'money-masked' : (s.amountCents < 0 ? 'money-negative' : 'money-positive');
        const balanceClass = maskBalance ? 'money-masked' : (occurrence.projectedBalanceCents < 0 ? 'money-negative' : 'money-positive');
        const badgeColors = preferences.badgeColors || {};
        const dueBadgeColor = window.BWBadgeColor.badgeStyle(occurrence.isDue ? badgeColors.due : badgeColors.scheduled);
        const autopayBadgeColor = window.BWBadgeColor.badgeStyle(badgeColors.autopay);
        tr.innerHTML = `
            <td></td>
            <td></td>
            <td data-col="date">${window.BWDate.formatDate(occurrence.date)}</td>
            <td data-col="payee">${payeeCell}</td>
            <td data-col="category">${category}</td>
            <td data-col="notes" title="${escapeAttr(s.notes || '')}">${s.notes || ''}</td>
            <td data-col="tags"></td>
            <td class="money ${amountClass}" data-col="amount">${window.BWMoney.formatCents(s.amountCents, maskAmount)}</td>
            <td class="money ${balanceClass}" data-col="balance" title="Estimated — assumes every scheduled item between now and here happens on time">${window.BWMoney.formatCents(occurrence.projectedBalanceCents, maskBalance)}</td>
            <td data-col="cleared"></td>
            <td class="row-actions">
                <span class="badge ${occurrence.isDue ? 'badge-warn' : ''}" style="${dueBadgeColor}" title="From schedule &quot;${s.name}&quot; — projected, not a real transaction yet">${occurrence.isDue ? 'Due' : 'Scheduled'}</span>
                ${s.autopay ? `<span class="badge" style="${autopayBadgeColor}" title="Autopay${s.autopayFromAccount ? ' — drafted from ' + s.autopayFromAccount.name : ''}">⟳</span>` : ''}
                ${accountRole === 'readonly' ? '' : '<button type="button" class="btn btn-secondary btn-sm icon-btn" data-occ-actions title="Edit or post this occurrence">⋯</button>'}
            </td>
        `;
        // Readonly access can still see upcoming occurrences (the access
        // table's "view upcoming only") but not open the edit/post modal —
        // matching schedulesController.js's requireAccountAccess({write:true})
        // on setOccurrenceOverride/postOccurrence.
        const actionsBtn = tr.querySelector('[data-occ-actions]');
        if (actionsBtn) actionsBtn.addEventListener('click', () => openOccurrenceModal(occurrence));
        applyColumnOrder(tr, normalizedColumnOrder());
        return tr;
    }

    // `sort` matches the register's own display sort ('newest'/'oldest'/
    // 'manual') so renderRegisterRows can place these rows to actually read
    // in chronological order alongside the real transactions — 'oldest'
    // flips the display pass below to soonest-first and gets rendered
    // AFTER the real transactions instead of pinned above them; 'manual'
    // has no inherent chronological direction (nothing here participates
    // in drag-and-drop) so it's treated the same as 'newest'.
    async function loadUpcomingRows(sort) {
        if (!preferences.upcomingSchedules.enabled) return [];
        try {
            const { amount, unit } = preferences.upcomingSchedules;
            const cutoff = new Date();
            if (unit === 'years') cutoff.setFullYear(cutoff.getFullYear() + amount);
            else if (unit === 'months') cutoff.setMonth(cutoff.getMonth() + amount);
            else cutoff.setDate(cutoff.getDate() + amount);

            // Projection now lives server-side (services/schedules/occurrenceProjection.js)
            // since it has to cross-reference which occurrences are already
            // posted (models/transaction.js's scheduleOccurrenceDate) and
            // merge in any per-occurrence overrides — data only the server
            // can efficiently query.
            const { occurrences: raw } = await window.BWApi.apiFetch(
                `/api/schedules/upcoming?account=${accountId}&cutoff=${cutoff.toISOString()}`
            );
            let occurrences = raw.map(o => ({ ...o, date: new Date(o.date) }));

            // Nearest-first to accumulate a projected balance outward from
            // the account's real current balance...
            occurrences.sort((a, b) => a.date - b.date);
            let running = currentBalanceCents;
            occurrences.forEach((o) => {
                running += o.schedule.amountCents;
                o.projectedBalanceCents = running;
            });

            // ...then re-sorted for display to match the chosen direction —
            // furthest-first for 'newest'/'manual' (reads top-to-bottom the
            // same way the register does, landing right above today's real
            // transactions), soonest-first for 'oldest' (continues on from
            // the newest real transaction, which sits at the bottom there).
            if (sort === 'oldest') occurrences.sort((a, b) => a.date - b.date);
            else occurrences.sort((a, b) => b.date - a.date);
            return occurrences.map(upcomingRow);
        } catch (err) {
            showError(err);
            return [];
        }
    }

    // ── Edit / post an upcoming occurrence ───────────────────────────
    let occurrenceContext = null;

    function openOccurrenceModal(occurrence) {
        occurrenceContext = occurrence;
        const s = occurrence.schedule;
        document.getElementById('occ-modal-subtitle').textContent = `${s.name} — ${window.BWDate.formatDate(occurrence.date)}`;

        const hasSplits = s.splits && s.splits.length > 0;
        const isTransfer = !!s.transferAccount;
        document.getElementById('occ-edit-fields').hidden = hasSplits;
        document.getElementById('occ-edit-splits-note').hidden = !hasSplits;
        // Amount/notes still apply per-occurrence for a transfer schedule —
        // only payee/category don't (the server clears them, see
        // controllers/schedulesController.js), and which account it
        // transfers to isn't something an occurrence override can change
        // (see models/schedule.js).
        document.getElementById('occ-edit-transfer-note').hidden = hasSplits || !isTransfer;
        document.getElementById('occ-payee-group').hidden = isTransfer;
        document.getElementById('occ-category-group').hidden = isTransfer;

        document.getElementById('occ-amount').value = (s.amountCents / 100).toFixed(2);
        document.getElementById('occ-payee').value = s.payee ? s.payee.name : '';
        document.getElementById('occ-category').value = s.category ? s.category.name : '';
        document.getElementById('occ-notes').value = s.notes || '';
        document.querySelector('input[name="occ-scope"][value="single"]').checked = true;
        document.getElementById('occ-scope-count-row').hidden = true;
        document.getElementById('occ-scope-count-input').value = 3;

        document.querySelector('input[name="occ-post-to"][value="scheduled"]').checked = true;
        document.getElementById('occ-post-custom-row').hidden = true;
        document.getElementById('occ-post-custom-date').value = window.BWDate.todayDateInputValue();

        document.getElementById('occurrence-overlay').hidden = false;
    }

    function closeOccurrenceModal() {
        document.getElementById('occurrence-overlay').hidden = true;
        occurrenceContext = null;
    }

    document.getElementById('occ-modal-cancel-btn').addEventListener('click', closeOccurrenceModal);

    document.querySelectorAll('input[name="occ-scope"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            const scope = document.querySelector('input[name="occ-scope"]:checked').value;
            document.getElementById('occ-scope-count-row').hidden = scope !== 'count';
        });
    });
    document.querySelectorAll('input[name="occ-post-to"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            const postTo = document.querySelector('input[name="occ-post-to"]:checked').value;
            document.getElementById('occ-post-custom-row').hidden = postTo !== 'custom';
        });
    });

    document.getElementById('occ-save-edit-btn').addEventListener('click', async () => {
        if (!occurrenceContext) return;
        try {
            const amountCents = window.BWMoney.toCents(document.getElementById('occ-amount').value || 0);
            const isTransfer = !!occurrenceContext.schedule.transferAccount;
            let payeeId = null;
            let categoryId = null;
            if (!isTransfer) {
                payeeId = await resolvePayee(document.getElementById('occ-payee').value.trim());
                const categoryName = document.getElementById('occ-category').value.trim();
                if (categoryName) {
                    const existing = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
                    if (!existing) throw new Error(`"${categoryName}" isn't an existing category — pick one from the list`);
                    categoryId = existing.id;
                }
            }
            const scope = document.querySelector('input[name="occ-scope"]:checked').value;
            await window.BWApi.apiFetch(`/api/schedules/${occurrenceContext.schedule.id}/occurrence`, {
                method: 'PUT',
                body: {
                    occurrenceDate: occurrenceContext.date.toISOString(),
                    scope,
                    count: Number(document.getElementById('occ-scope-count-input').value) || 1,
                    amountCents,
                    category: categoryId,
                    payee: payeeId,
                    notes: document.getElementById('occ-notes').value.trim()
                }
            });
            closeOccurrenceModal();
            await loadTransactions();
        } catch (err) {
            showError(err);
        }
    });

    function occScopeDescription() {
        const scope = document.querySelector('input[name="occ-scope"]:checked').value;
        if (scope === 'single') return 'this occurrence';
        if (scope === 'forever') return 'this and every occurrence after it';
        return `this and the next ${Number(document.getElementById('occ-scope-count-input').value) || 1} occurrences`;
    }

    document.getElementById('occ-delete-occ-btn').addEventListener('click', async () => {
        if (!occurrenceContext) return;
        if (!confirm(`Delete ${occScopeDescription()}? This can't be undone — they'll never be posted or shown as upcoming again.`)) return;
        try {
            const scope = document.querySelector('input[name="occ-scope"]:checked').value;
            await window.BWApi.apiFetch(`/api/schedules/${occurrenceContext.schedule.id}/occurrence`, {
                method: 'PUT',
                body: {
                    occurrenceDate: occurrenceContext.date.toISOString(),
                    scope,
                    count: Number(document.getElementById('occ-scope-count-input').value) || 1,
                    skip: true
                }
            });
            closeOccurrenceModal();
            await loadTransactions();
        } catch (err) {
            showError(err);
        }
    });

    document.getElementById('occ-delete-schedule-btn').addEventListener('click', async () => {
        if (!occurrenceContext) return;
        if (!confirm(`Delete the schedule "${occurrenceContext.schedule.name}" entirely? This can't be undone — every future occurrence goes with it (past posted transactions are unaffected).`)) return;
        try {
            await window.BWApi.apiFetch(`/api/schedules/${occurrenceContext.schedule.id}`, { method: 'DELETE' });
            closeOccurrenceModal();
            await loadTransactions();
        } catch (err) {
            showError(err);
        }
    });

    document.getElementById('occ-post-btn').addEventListener('click', async () => {
        if (!occurrenceContext) return;
        try {
            const postTo = document.querySelector('input[name="occ-post-to"]:checked').value;
            await window.BWApi.apiFetch(`/api/schedules/${occurrenceContext.schedule.id}/post`, {
                method: 'POST',
                body: {
                    occurrenceDate: occurrenceContext.date.toISOString(),
                    postTo,
                    customDate: postTo === 'custom' ? document.getElementById('occ-post-custom-date').value : undefined
                }
            });
            closeOccurrenceModal();
            await loadTransactions();
        } catch (err) {
            showError(err);
        }
    });

    // ── Forecast chart (collapsible, at the top of the register) ────────
    // Reuses the same projection the Dashboard's Account Balance forecast
    // widget is built from (services/reports/forecast.js via GET
    // /api/reports/forecast) — just rendered bigger/full-width here, with
    // an explicit "today" marker, and its past/future window sourced from
    // the register's OWN registerHistory/upcomingSchedules preferences
    // (Table settings) rather than a separate widget config, so it always
    // matches whatever window the register itself is showing.
    let forecastExpanded = true;

    // Same "nice" (1/2/5 × 10^n) rounding as the Dashboard's forecast
    // widget (public/js/dashboard.js's niceStepCents) — each page keeps
    // its own small copy rather than sharing a module, matching this app's
    // existing convention.
    function niceStepCents(rangeCents, targetLines) {
        const roughDollars = Math.max(1, (rangeCents / 100) / targetLines);
        const magnitude = Math.pow(10, Math.floor(Math.log10(roughDollars)));
        const residual = roughDollars / magnitude;
        let niceResidual;
        if (residual < 1.5) niceResidual = 1;
        else if (residual < 3.5) niceResidual = 2;
        else if (residual < 7.5) niceResidual = 5;
        else niceResidual = 10;
        return niceResidual * magnitude * 100;
    }

    function forecastAxisLabelIndexes(count) {
        if (count <= 2) return [0, count - 1];
        return [0, Math.floor((count - 1) / 2), count - 1];
    }

    // Same "nice" as dashboard.js's identical findThresholdCrossings —
    // every distinct FUTURE dip below the threshold, not just the first
    // match in `rows` overall (past-then-future, so a historical dip could
    // otherwise hide every actually-upcoming one) and not one row per day
    // of a multi-day dip, just the moment each one starts. `wasBelow`
    // resets the moment the projected segment starts, so an account
    // already under threshold today still gets its first projected day
    // flagged.
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

    // Same as dashboard.js's identical findThresholdDays — every individual
    // FUTURE calendar day below the threshold, not just the moment each dip
    // starts (that's findThresholdCrossings above, still used for the
    // chart's dots since the x-axis only has one position per occurrence).
    // Rows are sparse in the future segment (one point per schedule
    // occurrence, balance flat in between — see forecast.js), so each
    // below-threshold row's balance is expanded across every day up to (not
    // including) the next row's date. The final row has no following row to
    // bound it, so it only contributes its own day.
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

    // Same shape/mark classes as dashboard.js's buildForecastSvg, just a
    // much wider virtual canvas (full register width instead of one grid
    // cell) and an explicit "today" line — at this size the solid/dashed
    // line-style change alone is easy to miss as the past/projected
    // boundary. thresholdCents/thresholdColor come from the account itself
    // (models/account.js's forecastThresholdCents/Color, see
    // loadReferenceData) rather than a per-widget-instance setting — one
    // persistent value per account. thresholdCents is null when no warning
    // threshold is configured, OR when the account is a type where a
    // negative balance is normal (see loadForecastChart's
    // SUPPRESS_WARNING_TYPES check) — either way, the chart just shows the
    // balance line with no danger zone/line/crossing warnings.
    function buildRegisterForecastSvg(rows, thresholdCents, thresholdColor) {
        if (rows.length < 2) return { html: '<div class="empty-state">Not enough data yet.</div>', columns: [] };
        const width = 1400, height = 280;
        const padLeft = 72, padRight = 12, padTop = 16, padBottom = 28;
        const chartW = width - padLeft - padRight;
        const chartH = height - padTop - padBottom;
        const values = rows.map(r => r.balanceCents);
        const min = thresholdCents != null ? Math.min(0, thresholdCents, ...values) : Math.min(0, ...values);
        const max = thresholdCents != null ? Math.max(0, thresholdCents, ...values) : Math.max(0, ...values);
        const range = Math.max(1, max - min);
        const stepX = chartW / (rows.length - 1);
        const xAt = (i) => padLeft + i * stepX;
        const yAt = (v) => padTop + chartH - ((v - min) / range) * chartH;

        const firstProjected = rows.findIndex(r => r.projected);
        const pastEnd = firstProjected === -1 ? rows.length - 1 : firstProjected;
        const pastCoords = rows.slice(0, pastEnd + 1).map((r, i) => `${xAt(i)},${yAt(r.balanceCents)}`);
        const futureCoords = rows.slice(pastEnd).map((r, i) => `${xAt(pastEnd + i)},${yAt(r.balanceCents)}`);

        const dangerBottom = padTop + chartH;
        const thresholdY = thresholdCents != null ? yAt(thresholdCents) : null;
        const dangerHeight = thresholdCents != null ? dangerBottom - thresholdY : 0;

        const gridStep = niceStepCents(range, 5);
        const gridLines = [];
        for (let v = Math.ceil(min / gridStep) * gridStep; v <= max; v += gridStep) {
            const y = yAt(v);
            gridLines.push(`
                <line class="forecast-grid-line" x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}"></line>
                <text class="trend-axis-label" x="${padLeft - 8}" y="${y + 4}" text-anchor="end">${window.BWMoney.formatCents(v)}</text>
            `);
        }

        // "Today" sits at the same junction where the solid past line
        // meets the dashed projected one.
        const todayX = xAt(pastEnd);

        // The first/last labels sit right at the chart's own edges — anchor
        // them start/end (growing inward) instead of middle (growing both
        // ways), or the last one in particular overflows past the right
        // edge of the viewBox and gets clipped.
        const labelIndexes = forecastAxisLabelIndexes(rows.length);
        const xLabels = labelIndexes.map((i, pos) => {
            const anchor = pos === 0 ? 'start' : pos === labelIndexes.length - 1 ? 'end' : 'middle';
            return `<text class="trend-axis-label" x="${xAt(i)}" y="${height - 8}" text-anchor="${anchor}">${window.BWDate.formatDate(rows[i].date)}</text>`;
        }).join('');

        // Chart dots mark just the moment each FUTURE dip starts (one per
        // occurrence-spaced row). The text list below is every individual
        // day below the threshold instead, so a multi-day dip reads as a
        // full day-by-day list. Both skipped entirely when there's no
        // active threshold.
        const crossings = thresholdCents != null ? findThresholdCrossings(rows, thresholdCents) : [];
        const markers = crossings.map(c => `<circle class="forecast-threshold-marker" cx="${xAt(c.index)}" cy="${yAt(c.balanceCents)}" r="5" style="fill:${thresholdColor};"></circle>`).join('');
        const belowDays = thresholdCents != null ? findThresholdDays(rows, thresholdCents) : [];
        const callouts = belowDays.map(d => `<div class="forecast-warning" style="color:${thresholdColor};">⚠ Below ${window.BWMoney.formatCents(thresholdCents)} on ${window.BWDate.formatDate(d.date)} — projected balance ${window.BWMoney.formatCents(d.balanceCents)}</div>`).join('');

        const html = `
            <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Account forecast">
                ${gridLines.join('')}
                ${dangerHeight > 0 ? `<rect class="forecast-danger-zone" x="${padLeft}" y="${thresholdY}" width="${chartW}" height="${dangerHeight}" style="fill:${thresholdColor};fill-opacity:0.2;"></rect>` : ''}
                ${dangerHeight > 0 ? `<line class="forecast-threshold-line" x1="${padLeft}" y1="${thresholdY}" x2="${width - padRight}" y2="${thresholdY}" style="stroke:${thresholdColor};stroke-opacity:0.7;"></line>` : ''}
                <line class="forecast-today-line" x1="${todayX}" y1="${padTop}" x2="${todayX}" y2="${dangerBottom}"></line>
                <text class="trend-axis-label" x="${todayX}" y="${padTop - 4}" text-anchor="middle">Today</text>
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

    // Past/future window comes from the register's own Table settings
    // (registerHistory/upcomingSchedules) rather than a separate config, so
    // the chart always matches whatever window the register itself is
    // showing — using the stored amount/unit regardless of that setting's
    // own enabled/disabled toggle (which only controls whether upcoming-
    // schedule rows show in the transaction list, not whether the number
    // is a meaningful forecast horizon).
    async function loadForecastChart() {
        if (!forecastExpanded) return;
        const chartEl = document.getElementById('register-forecast-chart');
        try {
            const hist = preferences.registerHistory || {};
            const upcoming = preferences.upcomingSchedules || {};
            const params = new URLSearchParams({
                account: accountId,
                pastAmount: hist.amount || 3,
                pastUnit: hist.unit || 'months',
                futureAmount: upcoming.amount || 14,
                futureUnit: upcoming.unit || 'days'
            });
            const { rows } = await window.BWApi.apiFetch(`/api/reports/forecast?${params.toString()}`);
            const effectiveThresholdCents = SUPPRESS_WARNING_TYPES.includes(accountType) ? null : forecastThresholdCents;
            const { html, columns, bounds } = buildRegisterForecastSvg(rows, effectiveThresholdCents, forecastThresholdColor);
            chartEl.innerHTML = html;
            // #register-forecast-chart is a static element from the EJS
            // (always in the DOM), unlike the Dashboard's widgets — no need
            // to defer this past an append step.
            if (columns.length) window.BWChartHover.attach(chartEl.querySelector('svg'), chartEl, columns, bounds);
        } catch (err) {
            chartEl.innerHTML = '<div class="empty-state">Could not load the forecast.</div>';
        }
    }

    document.getElementById('toggle-forecast-btn').addEventListener('click', () => {
        forecastExpanded = !forecastExpanded;
        document.getElementById('register-forecast-chart').hidden = !forecastExpanded;
        document.getElementById('toggle-forecast-btn').textContent = forecastExpanded ? 'Hide' : 'Show';
        if (forecastExpanded) loadForecastChart();
    });

    // null means "no limit" — the default, so existing registers keep
    // showing full history until a user opts into a rolling window.
    function historyFromDate() {
        const { enabled, amount, unit } = preferences.registerHistory;
        if (!enabled) return null;
        const from = new Date();
        if (unit === 'years') from.setFullYear(from.getFullYear() - amount);
        else if (unit === 'months') from.setMonth(from.getMonth() - amount);
        else from.setDate(from.getDate() - amount);
        return from;
    }

    // ── Bulk category edit ────────────────────────────────────────────
    // Reflects selectedIds into the bar's count/visibility and the header
    // "select all" checkbox's checked/indeterminate state. Called on every
    // row checkbox change and after each register reload.
    function updateBulkBar() {
        const bar = document.getElementById('bulk-actions-bar');
        document.getElementById('bulk-selected-count').textContent = `${selectedIds.size} selected`;
        bar.hidden = selectedIds.size === 0;
        const selectAll = document.getElementById('select-all-checkbox');
        const boxes = [...document.querySelectorAll('#register-tbody .row-select-checkbox:not(:disabled)')];
        selectAll.checked = boxes.length > 0 && boxes.every(cb => cb.checked);
        selectAll.indeterminate = selectedIds.size > 0 && !selectAll.checked;
    }

    document.getElementById('select-all-checkbox').addEventListener('change', (e) => {
        const checked = e.target.checked;
        document.querySelectorAll('#register-tbody .row-select-checkbox:not(:disabled)').forEach((cb) => {
            cb.checked = checked;
            if (checked) selectedIds.add(cb.dataset.selectId);
            else selectedIds.delete(cb.dataset.selectId);
        });
        updateBulkBar();
    });

    document.getElementById('bulk-clear-btn').addEventListener('click', () => {
        selectedIds.clear();
        document.querySelectorAll('#register-tbody .row-select-checkbox').forEach((cb) => { cb.checked = false; });
        updateBulkBar();
    });

    document.getElementById('bulk-apply-category-btn').addEventListener('click', async () => {
        const select = document.getElementById('bulk-category-select');
        const categoryId = select.value;
        if (!categoryId || selectedIds.size === 0) return;
        const categoryName = select.options[select.selectedIndex].text;
        if (!confirm(`Set category to "${categoryName}" for ${selectedIds.size} transaction(s)?`)) return;
        clearError();
        try {
            await Promise.all([...selectedIds].map(id =>
                window.BWApi.apiFetch(`/api/transactions/${id}`, { method: 'PUT', body: { category: categoryId } })
            ));
            select.value = '';
            await loadReferenceData();
            await loadTransactions();
        } catch (err) {
            showError(err);
            await loadTransactions();
        }
    });

    // Substring match, case-insensitive — empty filter fields always match.
    // Amount compares against the same "-45.00" string the cell displays
    // (not cents), so typing "45" or "-45" both find it without needing to
    // know how the app stores money internally.
    function matchesFilters(t) {
        const f = filterState;
        if (f.date && !window.BWDate.formatDate(t.date).toLowerCase().includes(f.date)) return false;
        if (f.payee && !(t.payee ? t.payee.name : '').toLowerCase().includes(f.payee)) return false;
        if (f.category) {
            const categoryName = t.category ? t.category.name : (t.splits && t.splits.length ? 'split' : (t.transferAccount ? 'transfer' : ''));
            if (!categoryName.toLowerCase().includes(f.category)) return false;
        }
        if (f.notes && !(t.notes || '').toLowerCase().includes(f.notes)) return false;
        if (f.tags && !(t.tags || []).some(tag => tag.name.toLowerCase().includes(f.tags))) return false;
        if (f.amount && !(t.amountCents / 100).toFixed(2).includes(f.amount)) return false;
        return true;
    }

    // Divider row marking the start of the upcoming-schedule preview rows —
    // collapsed by default (see upcomingCollapsed) so the register reads as
    // just your actual transactions, with a click to expand back to the
    // full previous behavior. Independent of the Forecast chart above
    // (loadForecastChart's own fetch), which always shows the projection
    // regardless of this collapsed state.
    function upcomingDividerRow() {
        const tr = document.createElement('tr');
        tr.className = 'upcoming-divider-row';
        const count = currentUpcomingRows.length;
        const label = `${upcomingCollapsed ? '▸' : '▾'} ${count} upcoming transaction${count === 1 ? '' : 's'} — click to ${upcomingCollapsed ? 'show' : 'hide'}`;
        tr.innerHTML = `<td colspan="11"><button type="button" class="upcoming-toggle-btn" id="toggle-upcoming-rows-btn">${label}</button></td>`;
        tr.querySelector('#toggle-upcoming-rows-btn').addEventListener('click', () => {
            upcomingCollapsed = !upcomingCollapsed;
            renderRegisterRows();
        });
        return tr;
    }

    function appendUpcomingRows(tbody) {
        if (currentUpcomingRows.length === 0) return;
        tbody.appendChild(upcomingDividerRow());
        if (!upcomingCollapsed) currentUpcomingRows.forEach(row => tbody.appendChild(row));
    }

    // Re-renders #register-tbody from the cached currentTransactions /
    // currentBalanceById / currentUpcomingRows — no network call, so typing
    // in a filter box stays instant. loadTransactions() populates the cache;
    // filter input handlers just call this directly.
    function renderRegisterRows() {
        const tbody = document.getElementById('register-tbody');
        tbody.innerHTML = '';
        // 'oldest' reads top-to-bottom from the past toward today, so
        // upcoming (future) rows continue on AFTER the real transactions
        // instead of being pinned above them, and in soonest-first order —
        // see loadUpcomingRows' own sort, called with this same direction.
        const upcomingAtBottom = (preferences.registerSort || 'newest') === 'oldest';
        if (!upcomingAtBottom) appendUpcomingRows(tbody);

        if (currentTransactions.length === 0 && currentUpcomingRows.length === 0) {
            const from = historyFromDate();
            tbody.innerHTML = `<tr><td colspan="11" class="empty-state">${from ? 'No transactions in this time window.' : 'No transactions yet.'}</td></tr>`;
            updateBulkBar();
            return;
        }

        if (currentTransactions.length > 0) {
            const filtered = currentTransactions.filter(matchesFilters);
            if (filtered.length === 0) {
                const tr = document.createElement('tr');
                tr.innerHTML = '<td colspan="11" class="empty-state">No transactions match your filters.</td>';
                tbody.appendChild(tr);
            } else {
                filtered.forEach(t => tbody.appendChild(transactionRow(t, currentBalanceById.get(t.id))));
            }
        }

        if (upcomingAtBottom) appendUpcomingRows(tbody);
        updateBulkBar();
    }

    async function loadTransactions() {
        selectedIds.clear();
        try {
            const from = historyFromDate();
            const sort = preferences.registerSort || 'newest';
            const url = `/api/transactions?account=${accountId}&sort=${sort}` + (from ? `&from=${from.toISOString()}` : '');
            const { transactions } = await window.BWApi.apiFetch(url);
            transactionsById = new Map(transactions.map(t => [t.id, t]));
            currentTransactions = transactions;
            document.getElementById('register-hint').hidden = transactions.length < 2;

            currentUpcomingRows = await loadUpcomingRows(sort);

            // Balance math always walks newest-to-oldest by date regardless
            // of display order — 'manual' is the one exception, where the
            // drag-and-drop order itself defines the running balance (see
            // computeRunningBalances' doc comment). Computed from the FULL
            // list even though a filter might be active, so balances stay
            // correct — see renderRegisterRows.
            const balanceOrder = sort === 'manual' ? transactions : [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
            currentBalanceById = computeRunningBalances(balanceOrder);
            renderRegisterRows();
            await loadForecastChart();
        } catch (err) {
            showError(err);
        }
    }

    // ── Splits editor ──────────────────────────────────────────────
    function splitRow(categoryId, amount, notes) {
        const div = document.createElement('div');
        div.className = 'split-row';
        div.innerHTML = `
            <select class="split-category">${categoryOptionsHtml()}</select>
            <input type="number" class="split-amount" step="0.01" placeholder="0.00">
            <input type="text" class="split-notes" placeholder="Notes">
            <button type="button" class="btn btn-danger btn-sm" data-remove-split>&times;</button>
        `;
        if (categoryId) div.querySelector('.split-category').value = categoryId;
        if (amount !== undefined) div.querySelector('.split-amount').value = (amount / 100).toFixed(2);
        if (notes) div.querySelector('.split-notes').value = notes;
        div.querySelector('[data-remove-split]').addEventListener('click', () => div.remove());
        return div;
    }

    document.getElementById('add-split-btn').addEventListener('click', () => {
        document.getElementById('splits-list').appendChild(splitRow());
    });

    document.getElementById('toggle-splits-btn').addEventListener('click', () => {
        const editor = document.getElementById('splits-editor');
        const categoryGroup = document.getElementById('txn-category-group');
        editor.hidden = !editor.hidden;
        categoryGroup.hidden = !editor.hidden;
        if (!editor.hidden && document.getElementById('splits-list').children.length === 0) {
            document.getElementById('splits-list').appendChild(splitRow());
            document.getElementById('splits-list').appendChild(splitRow());
        }
    });

    document.getElementById('txn-is-transfer').addEventListener('change', (e) => {
        document.getElementById('txn-transfer-group').hidden = !e.target.checked;
        document.getElementById('txn-category-group').hidden = e.target.checked;
    });

    function readSplits() {
        return [...document.querySelectorAll('#splits-list .split-row')].map(row => ({
            category: row.querySelector('.split-category').value,
            amountCents: window.BWMoney.toCents(row.querySelector('.split-amount').value || 0),
            notes: row.querySelector('.split-notes').value
        })).filter(s => s.category);
    }

    // ── Rule suggestions ────────────────────────────────────────────
    document.getElementById('suggest-rules-btn').addEventListener('click', async () => {
        const payeeName = document.getElementById('txn-payee').value.trim();
        const amountCents = window.BWMoney.toCents(document.getElementById('txn-amount').value || 0);
        try {
            const suggestion = await window.BWApi.apiFetch('/api/transactions/preview-rules', {
                method: 'POST',
                body: { payee: payeeName, notes: document.getElementById('txn-notes').value, amountCents, account: accountId }
            });
            if (suggestion.categoryId) document.getElementById('txn-category').value = suggestion.categoryId;
            if (suggestion.payeeName) document.getElementById('txn-payee').value = suggestion.payeeName;
            if (suggestion.tagNames && suggestion.tagNames.length) document.getElementById('txn-tags').value = suggestion.tagNames.join(', ');
        } catch (err) {
            showError(err);
        }
    });

    // ── Resolve payee/tag names to ids, creating them if needed ─────
    async function resolvePayee(name) {
        if (!name) return null;
        const existing = payees.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;
        try {
            const created = await window.BWApi.apiFetch(`/api/payees?account=${accountId}`, { method: 'POST', body: { name } });
            payees.push(created);
            return created.id;
        } catch (err) {
            const refreshed = await window.BWApi.apiFetch(`/api/payees?account=${accountId}`);
            payees = refreshed.payees;
            const match = payees.find(p => p.name.toLowerCase() === name.toLowerCase());
            return match ? match.id : null;
        }
    }

    async function resolveTags(namesStr) {
        const names = (namesStr || '').split(',').map(s => s.trim()).filter(Boolean);
        const ids = [];
        for (const name of names) {
            try {
                const created = await window.BWApi.apiFetch(`/api/tags?account=${accountId}`, { method: 'POST', body: { name } });
                ids.push(created.id);
            } catch (err) {
                const { tags } = await window.BWApi.apiFetch(`/api/tags?account=${accountId}`);
                const match = tags.find(t => t.name.toLowerCase() === name.toLowerCase());
                if (match) ids.push(match.id);
            }
        }
        return ids;
    }

    // ── Save / edit / delete ─────────────────────────────────────────
    function startEdit(t) {
        if (accountRole === 'readonly') return;
        if (t.transferId) {
            alert("Transfers can't be edited directly — delete and recreate the transfer instead.");
            return;
        }
        editingId = t.id;
        document.getElementById('txn-form-card').hidden = false;
        document.getElementById('txn-form-title').textContent = 'Edit transaction';
        document.getElementById('txn-date').value = window.BWDate.toDateInputValue(t.date);
        document.getElementById('txn-payee').value = t.payee ? t.payee.name : '';
        document.getElementById('txn-amount').value = (t.amountCents / 100).toFixed(2);
        document.getElementById('txn-notes').value = t.notes || '';
        document.getElementById('txn-tags').value = (t.tags || []).map(tag => tag.name).join(', ');
        document.getElementById('txn-cleared').checked = t.cleared !== 'pending';
        document.getElementById('cancel-txn-btn').hidden = false;

        // Converting an existing transaction into a transfer isn't
        // supported — transfers are their own paired-transaction flow (see
        // createTransfer in transactionsController.js), and update() has no
        // path to it, so leaving this checkbox live during an edit let you
        // check it, hit Save, and have it silently do a normal update
        // instead (same "delete and recreate" limitation the transferId
        // guard above already enforces the other direction). Force it off
        // and hide it for the duration of this edit.
        document.getElementById('txn-is-transfer').checked = false;
        document.getElementById('txn-is-transfer').parentElement.hidden = true;
        document.getElementById('txn-transfer-group').hidden = true;

        // "Convert to transfer" covers the same gap — offered instead,
        // since it actually works (delete-and-recreate behind one button;
        // see convertToTransfer in transactionsController.js). Not for
        // splits — the backend rejects those (a split has no single "this
        // account's side" to make into a transfer).
        document.getElementById('convert-to-transfer-btn').hidden = !!(t.splits && t.splits.length);
        document.getElementById('convert-to-transfer-form').hidden = true;

        if (t.splits && t.splits.length) {
            document.getElementById('splits-editor').hidden = false;
            document.getElementById('txn-category-group').hidden = true;
            const list = document.getElementById('splits-list');
            list.innerHTML = '';
            t.splits.forEach(s => list.appendChild(splitRow(s.category.id || s.category, s.amountCents, s.notes)));
        } else {
            document.getElementById('splits-editor').hidden = true;
            document.getElementById('txn-category-group').hidden = false;
            document.getElementById('txn-category').value = t.category ? t.category.name : '';
            document.getElementById('txn-category-new-group').value = '';
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function resetForm() {
        editingId = null;
        document.getElementById('txn-form-title').textContent = 'New transaction';
        document.getElementById('txn-date').value = '';
        document.getElementById('txn-payee').value = '';
        document.getElementById('txn-amount').value = '';
        document.getElementById('txn-notes').value = '';
        document.getElementById('txn-tags').value = '';
        document.getElementById('txn-cleared').checked = false;
        document.getElementById('txn-category').value = '';
        document.getElementById('txn-category-new-group').value = '';
        document.getElementById('txn-is-transfer').checked = false;
        document.getElementById('txn-is-transfer').parentElement.hidden = false;
        document.getElementById('txn-transfer-group').hidden = true;
        document.getElementById('txn-category-group').hidden = false;
        document.getElementById('splits-editor').hidden = true;
        document.getElementById('splits-list').innerHTML = '';
        document.getElementById('cancel-txn-btn').hidden = true;
        document.getElementById('convert-to-transfer-btn').hidden = true;
        document.getElementById('convert-to-transfer-form').hidden = true;
        document.getElementById('txn-form-card').hidden = true;
    }

    document.getElementById('cancel-txn-btn').addEventListener('click', resetForm);

    // ── Convert an existing transaction to a transfer ────────────────
    document.getElementById('convert-to-transfer-btn').addEventListener('click', () => {
        const form = document.getElementById('convert-to-transfer-form');
        form.hidden = !form.hidden;
        if (!form.hidden) {
            document.getElementById('convert-transfer-account').innerHTML = accounts
                .filter(a => a.id !== accountId)
                .map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        }
    });
    document.getElementById('convert-to-transfer-cancel-btn').addEventListener('click', () => {
        document.getElementById('convert-to-transfer-form').hidden = true;
    });
    document.getElementById('convert-to-transfer-confirm-btn').addEventListener('click', async () => {
        if (!editingId) return;
        const toAccount = document.getElementById('convert-transfer-account').value;
        if (!toAccount) return showError(new Error('Pick an account to transfer to/from'));
        if (!confirm('This deletes the current entry and replaces it with a linked transfer pair. Continue?')) return;
        try {
            await window.BWApi.apiFetch(`/api/transactions/${editingId}/convert-to-transfer`, { method: 'POST', body: { toAccount } });
            resetForm();
            await loadReferenceData();
            await loadTransactions();
        } catch (err) {
            showError(err);
        }
    });

    // The full form (transfers/splits/edit) is collapsed by default — the
    // quick-add row below the table handles the common case instead.
    // Shared by the text link above the table and the quick-add row's own
    // ⛶ button — the latter matters once the quick-add row is sticky and
    // scrolled well past the link above, so the card itself is scrolled
    // into view too rather than just silently un-hidden off-screen.
    function openFullForm() {
        const card = document.getElementById('txn-form-card');
        resetForm();
        card.hidden = false;
        // resetForm() hides this too (it's shared with the close/reset
        // path) — startEdit() re-shows it for the edit case, this covers
        // the fresh-add case so there's always a way to back out of the
        // form once it's open, not just when editing an existing row.
        document.getElementById('cancel-txn-btn').hidden = false;
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.getElementById('toggle-advanced-form-link').addEventListener('click', (e) => {
        e.preventDefault();
        const card = document.getElementById('txn-form-card');
        if (card.hidden) {
            openFullForm();
        } else {
            resetForm();
        }
    });
    document.getElementById('qa-full-form-btn').addEventListener('click', openFullForm);

    document.getElementById('save-txn-btn').addEventListener('click', async () => {
        clearError();
        const date = document.getElementById('txn-date').value;
        const amountCents = window.BWMoney.toCents(document.getElementById('txn-amount').value || 0);
        if (!date) return showError(new Error('Date is required'));
        if (!amountCents) return showError(new Error('Amount is required'));
        if (editingId && document.getElementById('txn-is-transfer').checked) {
            return showError(new Error("Can't turn an existing transaction into a transfer — delete it and create the transfer fresh instead"));
        }

        try {
            if (document.getElementById('txn-is-transfer').checked && !editingId) {
                await window.BWApi.apiFetch('/api/transactions/transfer', {
                    method: 'POST',
                    body: {
                        fromAccount: accountId,
                        toAccount: document.getElementById('txn-transfer-account').value,
                        date, amountCents,
                        notes: document.getElementById('txn-notes').value
                    }
                });
            } else {
                const splits = document.getElementById('splits-editor').hidden ? [] : readSplits();
                const payeeId = await resolvePayee(document.getElementById('txn-payee').value.trim());
                const tagIds = await resolveTags(document.getElementById('txn-tags').value);
                const categoryId = splits.length ? null : await resolveCategory(
                    document.getElementById('txn-category').value.trim(),
                    document.getElementById('txn-category-new-group').value
                );
                const body = {
                    account: accountId, date, amountCents,
                    payee: payeeId,
                    category: categoryId,
                    splits,
                    cleared: document.getElementById('txn-cleared').checked ? 'cleared' : 'pending',
                    tags: tagIds,
                    notes: document.getElementById('txn-notes').value
                };
                if (editingId) {
                    await window.BWApi.apiFetch(`/api/transactions/${editingId}`, { method: 'PUT', body });
                } else {
                    await window.BWApi.apiFetch('/api/transactions', { method: 'POST', body });
                }
            }
            resetForm();
            await loadReferenceData();
            await loadTransactions();
        } catch (err) {
            showError(err);
        }
    });

    async function deleteTransaction(id) {
        if (accountRole === 'readonly') return;
        if (!confirm('Delete this transaction?')) return;
        try {
            await window.BWApi.apiFetch(`/api/transactions/${id}`, { method: 'DELETE' });
            await loadReferenceData();
            await loadTransactions();
        } catch (err) {
            showError(err);
        }
    }

    // ── Live filter row — narrows #register-tbody as you type, no re-fetch
    // (see matchesFilters/renderRegisterRows above). Stays in its own tbody
    // (see accounts/show.ejs), same as the quick-add row, so it survives
    // loadTransactions()'s innerHTML wipe of #register-tbody.
    const FILTER_FIELDS = ['date', 'payee', 'category', 'notes', 'tags', 'amount'];
    FILTER_FIELDS.forEach((field) => {
        document.getElementById(`filter-${field}`).addEventListener('input', (e) => {
            filterState[field] = e.target.value.trim().toLowerCase();
            renderRegisterRows();
        });
    });
    document.getElementById('filter-clear-btn').addEventListener('click', () => {
        FILTER_FIELDS.forEach((field) => {
            filterState[field] = '';
            document.getElementById(`filter-${field}`).value = '';
        });
        renderRegisterRows();
    });

    // ── Quick-add row — a live "type straight into the table" entry point
    // for the common case (no transfer, no split). Stays in its own tbody
    // (see accounts/show.ejs) so loadTransactions()'s innerHTML wipe of
    // #register-tbody never touches it.
    document.getElementById('qa-add-btn').addEventListener('click', async () => {
        clearError();
        const date = document.getElementById('qa-date').value;
        const amountCents = window.BWMoney.toCents(document.getElementById('qa-amount').value || 0);
        if (!date) return showError(new Error('Date is required'));
        if (!amountCents) return showError(new Error('Amount is required'));

        try {
            const payeeId = await resolvePayee(document.getElementById('qa-payee').value.trim());
            const tagIds = await resolveTags(document.getElementById('qa-tags').value);
            // No group picker on the quick-add row (see views/accounts/show.ejs) —
            // a category typed here that doesn't exist yet lands in the
            // first category group (categoryGroups is already sorted by
            // sortOrder/name, same order as every group dropdown). Picking a
            // specific group for a new category still needs the full form.
            const categoryId = await resolveCategory(
                document.getElementById('qa-category').value.trim(),
                categoryGroups.length ? categoryGroups[0].id : null
            );

            await window.BWApi.apiFetch('/api/transactions', {
                method: 'POST',
                body: {
                    account: accountId, date, amountCents,
                    payee: payeeId,
                    category: categoryId,
                    cleared: document.getElementById('qa-cleared').checked ? 'cleared' : 'pending',
                    tags: tagIds,
                    notes: document.getElementById('qa-notes').value
                }
            });

            // Left in place (not removed) — clear it out and leave the date
            // as-is so entering several same-day transactions stays fast.
            document.getElementById('qa-payee').value = '';
            document.getElementById('qa-category').value = '';
            document.getElementById('qa-notes').value = '';
            document.getElementById('qa-tags').value = '';
            document.getElementById('qa-amount').value = '';
            document.getElementById('qa-cleared').checked = true;
            document.getElementById('qa-payee').focus();

            await loadReferenceData();
            await loadTransactions();
        } catch (err) {
            showError(err);
        }
    });

    (async function init() {
        document.getElementById('qa-date').value = window.BWDate.todayDateInputValue();

        await loadPreferences();
        await loadReferenceData();
        await loadTransactions();

        // Registered once against the tbody element itself (its identity
        // never changes across reloads — only its innerHTML is replaced),
        // so this doesn't stack a duplicate listener on every reload.
        const tbody = document.getElementById('register-tbody');
        window.BWDragReorder.makeSortable(tbody, async (ids) => {
            refreshBalanceDisplay();
            try {
                await window.BWApi.apiFetch('/api/transactions/reorder', { method: 'POST', body: { ids, account: accountId } });
                // A drag only "sticks" under manual sort (see
                // services/database/transactions.js's SORTS) — date modes
                // ignore sortOrder entirely, so without this the very next
                // reload would snap the row straight back to its date
                // position. Switching here, the moment a row actually gets
                // dragged, is what lets drag-and-drop work from any sort mode.
                if (preferences.registerSort !== 'manual') {
                    preferences = await window.BWApi.apiFetch('/api/auth/preferences', { method: 'PUT', body: { registerSort: 'manual' } });
                    const sortSelect = document.getElementById('pref-register-sort');
                    if (sortSelect) sortSelect.value = 'manual';
                }
            } catch (err) {
                showError(err);
            }
        });

        // Enter submits the quick-add row from any of its text/number
        // fields, like filling out a spreadsheet row.
        document.querySelectorAll('.quick-add-row input').forEach((input) => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('qa-add-btn').click();
                }
            });
        });
    })();
})();
