(function () {
    const page = document.querySelector('.page-register');
    if (!page) return;
    const accountId = page.dataset.accountId;
    const errorBox = document.getElementById('register-error');

    let accounts = [];
    let categories = [];
    let categoryGroups = [];
    let payees = [];
    let editingId = null;
    let currentBalanceCents = 0;
    let transactionsById = new Map();
    let preferences = null;
    // Bulk category selection — ids of currently-checked rows. Cleared on
    // every loadTransactions() reload rather than tracked across reloads,
    // since the set of rendered rows (and which are even selectable) can
    // change with the sort/filter/history-window preferences.
    let selectedIds = new Set();
    // 'owner' unless this register belongs to an account someone else
    // shared with us (see accountsController.js's serialize) — gates every
    // write control below. Every reference-data fetch always carries
    // ?account=<accountId> too, which is a harmless no-op when it resolves
    // to yourself (see services/authz/actingOwner.js's resolveActingOwner).
    let accountRole = 'owner';

    const COLUMN_LABELS = {
        date: 'Date', payee: 'Payee', category: 'Category', notes: 'Notes',
        tags: 'Tags', amount: 'Amount', balance: 'Balance', cleared: 'Cleared'
    };
    const DEFAULT_PREFERENCES = {
        registerSort: 'newest',
        registerMask: { amount: false, balance: false },
        registerColumns: { date: true, payee: true, category: true, notes: true, tags: true, amount: true, balance: true, cleared: true },
        upcomingSchedules: { enabled: false, amount: 14, unit: 'days' },
        registerHistory: { enabled: false, amount: 3, unit: 'months' }
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
        accounts = accountsRes.accounts;
        categories = categoriesRes.categories;
        categoryGroups = categoryGroupsRes.categoryGroups;
        payees = payeesRes.payees;

        document.getElementById('account-name').textContent = account.name;
        currentBalanceCents = account.balanceCents;
        renderAccountBalance();

        document.getElementById('category-options').innerHTML = categories.map(c => `<option value="${c.name}">`).join('');
        document.getElementById('bulk-category-select').innerHTML = '<option value="">— choose category —</option>' +
            categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        const groupOptionsHtml = '<option value="">— pick a group —</option>' +
            categoryGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
        document.getElementById('txn-category-new-group').innerHTML = groupOptionsHtml;
        document.getElementById('qa-category-new-group').innerHTML = '<option value="">new category group...</option>' +
            categoryGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
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
        document.querySelector('.page-register').classList.toggle('register-readonly', readonly);
        document.getElementById('select-all-checkbox').closest('th').style.display = readonly ? 'none' : '';
        if (readonly) document.getElementById('bulk-actions-bar').hidden = true;
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

    function transactionRow(t, balanceCents) {
        const tr = document.createElement('tr');
        // Dragging works regardless of sort mode — see the reorder handler
        // in init() below, which switches the sort preference to 'manual'
        // the moment a row actually gets dragged, so the new position
        // sticks instead of snapping back to date order on next load.
        tr.draggable = accountRole !== 'readonly';
        tr.dataset.dragId = t.id;
        const category = t.category ? t.category.name : (t.splits && t.splits.length ? 'Split' : (t.transferAccount ? 'Transfer' : ''));
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
            <td class="drag-handle" title="Drag to reorder">⠿</td>
            <td class="editable-cell" data-col="date">${window.BWDate.formatDate(t.date)}</td>
            <td class="editable-cell" data-col="payee">${t.payee ? t.payee.name : ''}</td>
            <td class="editable-cell" data-col="category">${category}</td>
            <td class="wrap editable-cell" data-col="notes">${t.notes || ''}</td>
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

    function applyColumnPreferences() {
        const table = document.querySelector('.register-table');
        Object.keys(COLUMN_LABELS).forEach((key) => {
            table.classList.toggle(`hide-col-${key}`, !preferences.registerColumns[key]);
        });
    }

    function renderColumnToggles() {
        document.getElementById('column-toggle-list').innerHTML = Object.entries(COLUMN_LABELS).map(([key, label]) => `
            <label class="checkbox-row" style="width:auto;">
                <input type="checkbox" class="col-toggle-checkbox" data-col-key="${key}" ${preferences.registerColumns[key] ? 'checked' : ''}>
                ${label}
            </label>
        `).join('');
    }

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
        renderColumnToggles();
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
    document.getElementById('save-settings-btn').addEventListener('click', async () => {
        const registerSort = document.getElementById('pref-register-sort').value;
        const registerColumns = {};
        document.querySelectorAll('.col-toggle-checkbox').forEach((cb) => { registerColumns[cb.dataset.colKey] = cb.checked; });
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
            preferences = await window.BWApi.apiFetch('/api/auth/preferences', { method: 'PUT', body: { registerSort, registerColumns, upcomingSchedules, registerHistory } });
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
        const category = s.category ? s.category.name : (s.splits && s.splits.length ? 'Split' : '');
        const maskAmount = preferences.registerMask && preferences.registerMask.amount;
        const maskBalance = preferences.registerMask && preferences.registerMask.balance;
        const amountClass = maskAmount ? 'money-masked' : (s.amountCents < 0 ? 'money-negative' : 'money-positive');
        const balanceClass = maskBalance ? 'money-masked' : (occurrence.projectedBalanceCents < 0 ? 'money-negative' : 'money-positive');
        tr.innerHTML = `
            <td></td>
            <td></td>
            <td data-col="date">${window.BWDate.formatDate(occurrence.date)}</td>
            <td data-col="payee">${s.payee ? s.payee.name : ''}</td>
            <td data-col="category">${category}</td>
            <td class="wrap" data-col="notes">${s.notes || ''}</td>
            <td data-col="tags"></td>
            <td class="money ${amountClass}" data-col="amount">${window.BWMoney.formatCents(s.amountCents, maskAmount)}</td>
            <td class="money ${balanceClass}" data-col="balance" title="Estimated — assumes every scheduled item between now and here happens on time">${window.BWMoney.formatCents(occurrence.projectedBalanceCents, maskBalance)}</td>
            <td data-col="cleared"></td>
            <td class="row-actions">
                <span class="badge ${occurrence.isDue ? 'badge-warn' : ''}" title="From schedule &quot;${s.name}&quot; — projected, not a real transaction yet">${occurrence.isDue ? 'Due' : 'Scheduled'}</span>
                ${accountRole === 'readonly' ? '' : '<button type="button" class="btn btn-secondary btn-sm icon-btn" data-occ-actions title="Edit or post this occurrence">⋯</button>'}
            </td>
        `;
        // Readonly access can still see upcoming occurrences (the access
        // table's "view upcoming only") but not open the edit/post modal —
        // matching schedulesController.js's requireAccountAccess({write:true})
        // on setOccurrenceOverride/postOccurrence.
        const actionsBtn = tr.querySelector('[data-occ-actions]');
        if (actionsBtn) actionsBtn.addEventListener('click', () => openOccurrenceModal(occurrence));
        return tr;
    }

    async function loadUpcomingRows() {
        if (!preferences.upcomingSchedules.enabled) return [];
        try {
            const { amount, unit } = preferences.upcomingSchedules;
            const cutoff = new Date();
            if (unit === 'months') cutoff.setMonth(cutoff.getMonth() + amount);
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

            // ...then furthest-first for display, so the projection reads
            // top-to-bottom the same "newest first" way the rest of the
            // register does, landing right above today's real transactions.
            occurrences.sort((a, b) => b.date - a.date);
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
        document.getElementById('occ-edit-fields').hidden = hasSplits;
        document.getElementById('occ-edit-splits-note').hidden = !hasSplits;

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
            const payeeId = await resolvePayee(document.getElementById('occ-payee').value.trim());
            const categoryName = document.getElementById('occ-category').value.trim();
            let categoryId = null;
            if (categoryName) {
                const existing = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
                if (!existing) throw new Error(`"${categoryName}" isn't an existing category — pick one from the list`);
                categoryId = existing.id;
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

    // null means "no limit" — the default, so existing registers keep
    // showing full history until a user opts into a rolling window.
    function historyFromDate() {
        const { enabled, amount, unit } = preferences.registerHistory;
        if (!enabled) return null;
        const from = new Date();
        if (unit === 'months') from.setMonth(from.getMonth() - amount);
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

    async function loadTransactions() {
        selectedIds.clear();
        try {
            const from = historyFromDate();
            const sort = preferences.registerSort || 'newest';
            const url = `/api/transactions?account=${accountId}&sort=${sort}` + (from ? `&from=${from.toISOString()}` : '');
            const { transactions } = await window.BWApi.apiFetch(url);
            transactionsById = new Map(transactions.map(t => [t.id, t]));
            const tbody = document.getElementById('register-tbody');
            tbody.innerHTML = '';
            document.getElementById('register-hint').hidden = transactions.length < 2;

            const upcomingRows = await loadUpcomingRows();
            upcomingRows.forEach(row => tbody.appendChild(row));

            if (transactions.length === 0) {
                if (upcomingRows.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="11" class="empty-state">${from ? 'No transactions in this time window.' : 'No transactions yet.'}</td></tr>`;
                }
                updateBulkBar();
                return;
            }
            // Balance math always walks newest-to-oldest by date regardless
            // of display order — 'manual' is the one exception, where the
            // drag-and-drop order itself defines the running balance (see
            // computeRunningBalances' doc comment).
            const balanceOrder = sort === 'manual' ? transactions : [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
            const balanceById = computeRunningBalances(balanceOrder);
            transactions.forEach(t => tbody.appendChild(transactionRow(t, balanceById.get(t.id))));
            updateBulkBar();
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
        document.getElementById('txn-transfer-group').hidden = true;
        document.getElementById('txn-category-group').hidden = false;
        document.getElementById('splits-editor').hidden = true;
        document.getElementById('splits-list').innerHTML = '';
        document.getElementById('cancel-txn-btn').hidden = true;
        document.getElementById('txn-form-card').hidden = true;
    }

    document.getElementById('cancel-txn-btn').addEventListener('click', resetForm);

    // The full form (transfers/splits/edit) is collapsed by default — the
    // quick-add row below the table handles the common case instead.
    document.getElementById('toggle-advanced-form-link').addEventListener('click', (e) => {
        e.preventDefault();
        const card = document.getElementById('txn-form-card');
        if (card.hidden) {
            resetForm();
            card.hidden = false;
        } else {
            resetForm();
        }
    });

    document.getElementById('save-txn-btn').addEventListener('click', async () => {
        clearError();
        const date = document.getElementById('txn-date').value;
        const amountCents = window.BWMoney.toCents(document.getElementById('txn-amount').value || 0);
        if (!date) return showError(new Error('Date is required'));
        if (!amountCents) return showError(new Error('Amount is required'));

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
            const categoryId = await resolveCategory(
                document.getElementById('qa-category').value.trim(),
                document.getElementById('qa-category-new-group').value
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
            document.getElementById('qa-category-new-group').value = '';
            document.getElementById('qa-notes').value = '';
            document.getElementById('qa-tags').value = '';
            document.getElementById('qa-amount').value = '';
            document.getElementById('qa-cleared').checked = false;
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
                await window.BWApi.apiFetch('/api/transactions/reorder', { method: 'POST', body: { ids } });
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
