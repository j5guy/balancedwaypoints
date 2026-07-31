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
    let startingBalanceCents = 0;
    let currentBalanceCents = 0;
    let transactionsById = new Map();
    let preferences = null;

    const COLUMN_LABELS = {
        date: 'Date', payee: 'Payee', category: 'Category', notes: 'Notes',
        tags: 'Tags', amount: 'Amount', balance: 'Balance', cleared: 'Cleared'
    };
    const DEFAULT_PREFERENCES = {
        registerColumns: { date: true, payee: true, category: true, notes: true, tags: true, amount: true, balance: true, cleared: true },
        upcomingSchedules: { enabled: false, amount: 14, unit: 'days' }
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

    async function loadReferenceData() {
        const [accountsRes, categoriesRes, categoryGroupsRes, payeesRes] = await Promise.all([
            window.BWApi.apiFetch('/api/accounts'),
            window.BWApi.apiFetch('/api/categories'),
            window.BWApi.apiFetch('/api/category-groups'),
            window.BWApi.apiFetch('/api/payees')
        ]);
        accounts = accountsRes.accounts;
        categories = categoriesRes.categories;
        categoryGroups = categoryGroupsRes.categoryGroups;
        payees = payeesRes.payees;

        const account = accounts.find(a => a.id === accountId);
        document.getElementById('account-name').textContent = account ? account.name : 'Register';
        if (account) {
            startingBalanceCents = account.startingBalanceCents;
            currentBalanceCents = account.balanceCents;
            const balEl = document.getElementById('account-balance');
            balEl.textContent = window.BWMoney.formatCents(account.balanceCents);
            balEl.classList.add(account.balanceCents < 0 ? 'money-negative' : 'money-positive');
        }

        document.getElementById('category-options').innerHTML = categories.map(c => `<option value="${c.name}">`).join('');
        const groupOptionsHtml = '<option value="">— pick a group —</option>' +
            categoryGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
        document.getElementById('txn-category-new-group').innerHTML = groupOptionsHtml;
        document.getElementById('qa-category-new-group').innerHTML = '<option value="">new category group...</option>' +
            categoryGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
        document.getElementById('txn-transfer-account').innerHTML = accounts
            .filter(a => a.id !== accountId)
            .map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        document.getElementById('payee-options').innerHTML = payees.map(p => `<option value="${p.name}">`).join('');
    }

    // Resolves a typed category name to an id, creating the category (in the
    // group picked in the "new category" select) if it doesn't exist yet —
    // same pattern as resolvePayee/resolveTags below.
    async function resolveCategory(name, groupId) {
        if (!name) return null;
        const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;
        if (!groupId) throw new Error(`"${name}" isn't an existing category — pick a group to create it in`);
        const created = await window.BWApi.apiFetch('/api/categories', { method: 'POST', body: { name, group: groupId } });
        categories.push(created);
        return created.id;
    }

    // Running balance follows the DISPLAY order (top-to-bottom, newest at
    // top by default) rather than the transaction date — so dragging a row
    // to a new position recalculates every balance between its old and new
    // spot, same as physically re-ordering entries in a paper ledger would.
    // orderedTransactions must already be in top-to-bottom display order;
    // the bottom-most row is treated as "earliest" and accumulates up from
    // the account's starting balance.
    function computeRunningBalances(orderedTransactions) {
        let running = startingBalanceCents;
        const balanceById = new Map();
        for (let i = orderedTransactions.length - 1; i >= 0; i--) {
            const t = orderedTransactions[i];
            running += t.amountCents;
            balanceById.set(t.id, running);
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
            cell.textContent = window.BWMoney.formatCents(balanceCents);
            cell.classList.remove('money-positive', 'money-negative');
            cell.classList.add(balanceCents < 0 ? 'money-negative' : 'money-positive');
        });
    }

    function transactionRow(t, balanceCents) {
        const tr = document.createElement('tr');
        tr.draggable = true;
        tr.dataset.dragId = t.id;
        const category = t.category ? t.category.name : (t.splits && t.splits.length ? 'Split' : (t.transferAccount ? 'Transfer' : ''));
        const amountClass = t.amountCents < 0 ? 'money-negative' : 'money-positive';
        const balanceClass = balanceCents < 0 ? 'money-negative' : 'money-positive';
        const isCleared = t.cleared !== 'pending';
        tr.innerHTML = `
            <td class="drag-handle">⠿</td>
            <td data-col="date">${new Date(t.date).toLocaleDateString()}</td>
            <td data-col="payee">${t.payee ? t.payee.name : ''}</td>
            <td data-col="category">${category}</td>
            <td class="wrap" data-col="notes">${t.notes || ''}</td>
            <td data-col="tags">${(t.tags || []).map(tag => `<span class="badge">${tag.name}</span>`).join(' ')}</td>
            <td class="money ${amountClass}" data-col="amount">${window.BWMoney.formatCents(t.amountCents)}</td>
            <td class="money js-balance-cell ${balanceClass}" data-col="balance">${window.BWMoney.formatCents(balanceCents)}</td>
            <td class="row-actions">
                <button type="button" class="btn btn-secondary btn-sm icon-btn" data-edit title="Edit">✎</button>
                <button type="button" class="btn btn-danger btn-sm icon-btn" data-delete title="Delete">🗑</button>
            </td>
            <td data-col="cleared">
                <button type="button" class="cleared-toggle ${isCleared ? 'cleared-toggle-on' : 'cleared-toggle-off'}"
                        data-cleared-toggle title="${isCleared ? 'Cleared — click to mark pending' : 'Pending — click to mark cleared'}">${isCleared ? '✓' : '✕'}</button>
            </td>
        `;
        tr.querySelector('[data-edit]').addEventListener('click', () => startEdit(t));
        tr.querySelector('[data-delete]').addEventListener('click', () => deleteTransaction(t.id));
        tr.querySelector('[data-cleared-toggle]').addEventListener('click', () => toggleCleared(t));
        return tr;
    }

    // Cleared is binary in this UI (a checkmark or an x) — toggling never
    // sets 'reconciled', only flips between 'pending' and 'cleared'. Updates
    // the button in place rather than reloading the whole register.
    async function toggleCleared(t) {
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

    document.getElementById('toggle-settings-btn').addEventListener('click', () => {
        const panel = document.getElementById('settings-panel');
        if (!panel.hidden) { panel.hidden = true; return; }
        renderColumnToggles();
        document.getElementById('pref-show-upcoming').checked = preferences.upcomingSchedules.enabled;
        document.getElementById('pref-upcoming-amount').value = preferences.upcomingSchedules.amount;
        document.getElementById('pref-upcoming-unit').value = preferences.upcomingSchedules.unit;
        panel.hidden = false;
    });
    document.getElementById('cancel-settings-btn').addEventListener('click', () => {
        document.getElementById('settings-panel').hidden = true;
    });
    document.getElementById('save-settings-btn').addEventListener('click', async () => {
        const registerColumns = {};
        document.querySelectorAll('.col-toggle-checkbox').forEach((cb) => { registerColumns[cb.dataset.colKey] = cb.checked; });
        const upcomingSchedules = {
            enabled: document.getElementById('pref-show-upcoming').checked,
            amount: Math.max(1, Number(document.getElementById('pref-upcoming-amount').value) || 1),
            unit: document.getElementById('pref-upcoming-unit').value
        };
        try {
            preferences = await window.BWApi.apiFetch('/api/auth/preferences', { method: 'PUT', body: { registerColumns, upcomingSchedules } });
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
    // clearly marked with "~" since it's an estimate, not the real thing
    // computeRunningBalances produces for actual transactions.
    function upcomingRow(occurrence) {
        const s = occurrence.schedule;
        const tr = document.createElement('tr');
        tr.className = 'upcoming-row';
        const category = s.category ? s.category.name : (s.splits && s.splits.length ? 'Split' : '');
        const amountClass = s.amountCents < 0 ? 'money-negative' : 'money-positive';
        const balanceClass = occurrence.projectedBalanceCents < 0 ? 'money-negative' : 'money-positive';
        tr.innerHTML = `
            <td></td>
            <td data-col="date">${occurrence.date.toLocaleDateString()}</td>
            <td data-col="payee">${s.payee ? s.payee.name : ''}</td>
            <td data-col="category">${category}</td>
            <td class="wrap" data-col="notes">${s.notes || ''}</td>
            <td data-col="tags"></td>
            <td class="money ${amountClass}" data-col="amount">${window.BWMoney.formatCents(s.amountCents)}</td>
            <td class="money ${balanceClass}" data-col="balance" title="Estimated — assumes every scheduled item between now and here happens on time">~${window.BWMoney.formatCents(occurrence.projectedBalanceCents)}</td>
            <td><span class="badge" title="From schedule &quot;${s.name}&quot; — projected, not a real transaction yet">Scheduled</span></td>
            <td data-col="cleared"></td>
        `;
        return tr;
    }

    // A schedule's own nextDate is only its NEXT single occurrence — to show
    // every occurrence out to the configured cutoff (e.g. 6 monthly
    // occurrences over a 6-month window), each one has to be projected
    // forward using the same interval math the server's auto-enter job uses
    // (services/schedules/nextOccurrence.js) until it passes the cutoff (or
    // the schedule's own endDate, if it has one).
    function projectOccurrences(schedule, cutoff) {
        const occurrences = [];
        let date = new Date(schedule.nextDate);
        const endDate = schedule.endDate ? new Date(schedule.endDate) : null;
        let guard = 0;
        while (date <= cutoff && (!endDate || date <= endDate) && guard < 500) {
            occurrences.push({ schedule, date: new Date(date) });
            guard++;
            const next = new Date(date);
            const { unit, interval } = schedule.frequency;
            if (unit === 'days') next.setUTCDate(next.getUTCDate() + interval);
            else if (unit === 'weeks') next.setUTCDate(next.getUTCDate() + interval * 7);
            else if (unit === 'months') next.setUTCMonth(next.getUTCMonth() + interval);
            else if (unit === 'years') next.setUTCFullYear(next.getUTCFullYear() + interval);
            date = next;
        }
        return occurrences;
    }

    async function loadUpcomingRows() {
        if (!preferences.upcomingSchedules.enabled) return [];
        try {
            const { schedules } = await window.BWApi.apiFetch('/api/schedules');
            const { amount, unit } = preferences.upcomingSchedules;
            const cutoff = new Date();
            if (unit === 'months') cutoff.setMonth(cutoff.getMonth() + amount);
            else cutoff.setDate(cutoff.getDate() + amount);

            let occurrences = schedules
                .filter(s => s.active && s.account === accountId)
                .flatMap(s => projectOccurrences(s, cutoff));

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

    async function loadTransactions() {
        try {
            const { transactions } = await window.BWApi.apiFetch(`/api/transactions?account=${accountId}`);
            transactionsById = new Map(transactions.map(t => [t.id, t]));
            const tbody = document.getElementById('register-tbody');
            tbody.innerHTML = '';
            document.getElementById('register-hint').hidden = transactions.length < 2;

            const upcomingRows = await loadUpcomingRows();
            upcomingRows.forEach(row => tbody.appendChild(row));

            if (transactions.length === 0) {
                if (upcomingRows.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No transactions yet.</td></tr>';
                }
                return;
            }
            const balanceById = computeRunningBalances(transactions);
            transactions.forEach(t => tbody.appendChild(transactionRow(t, balanceById.get(t.id))));
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
                body: { payee: payeeName, notes: document.getElementById('txn-notes').value, amountCents }
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
            const created = await window.BWApi.apiFetch('/api/payees', { method: 'POST', body: { name } });
            payees.push(created);
            return created.id;
        } catch (err) {
            const refreshed = await window.BWApi.apiFetch('/api/payees');
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
                const created = await window.BWApi.apiFetch('/api/tags', { method: 'POST', body: { name } });
                ids.push(created.id);
            } catch (err) {
                const { tags } = await window.BWApi.apiFetch('/api/tags');
                const match = tags.find(t => t.name.toLowerCase() === name.toLowerCase());
                if (match) ids.push(match.id);
            }
        }
        return ids;
    }

    // ── Save / edit / delete ─────────────────────────────────────────
    function startEdit(t) {
        if (t.transferId) {
            alert("Transfers can't be edited directly — delete and recreate the transfer instead.");
            return;
        }
        editingId = t.id;
        document.getElementById('txn-form-card').hidden = false;
        document.getElementById('txn-form-title').textContent = 'Edit transaction';
        document.getElementById('txn-date').value = new Date(t.date).toISOString().slice(0, 10);
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
        document.getElementById('qa-date').value = new Date().toISOString().slice(0, 10);

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
