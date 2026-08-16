(function () {
    const tbody = document.getElementById('schedules-tbody');
    if (!tbody) return;
    const errorBox = document.getElementById('schedules-error');
    const form = document.getElementById('schedule-form');
    let accounts = [];
    let categories = [];
    let categoryGroups = [];
    let payees = [];
    let preferences = { badgeColors: { scheduled: null, due: null, autopay: null } };
    let editingId = null;
    let ownerSwitcher = { forOwnerId: () => null };
    // Live per-column filter (see the "Filter…" row in views/schedules/index.ejs,
    // same pattern as the register's — see public/js/register.js's
    // filterState/matchesFilters/renderRegisterRows). Purely client-side
    // over whatever load() last fetched, so typing never re-fetches.
    let currentSchedules = [];
    let filterState = { name: '', account: '', payee: '', amount: '', category: '', nextdate: '', repeats: '' };

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    // See public/js/payees.js's identical helper. Only used for the list/
    // reference-data reads here — create/update/delete/auto-toggle resolve
    // access via the schedule's own `account` field server-side instead
    // (see controllers/schedulesController.js), since schedules are
    // per-account rather than owner-wide.
    function forQuery() {
        const id = ownerSwitcher.forOwnerId();
        return id ? `?for=${id}` : '';
    }

    // The Account dropdown needs a different source depending on who we're
    // managing: our own accounts, or — when acting as an owner via the
    // switcher — only the accounts of THEIRS we specifically hold readwrite
    // on (schedules stay account-scoped even under "full management", see
    // the Phase 2 plan's access-tiers table). There's no endpoint that lists
    // another owner's full account set, so this is necessarily narrower
    // than "every account that owner has."
    async function loadAccountOptions() {
        const forId = ownerSwitcher.forOwnerId();
        if (!forId) {
            const { accounts } = await window.BWApi.apiFetch('/api/accounts');
            return accounts;
        }
        const { accounts } = await window.BWApi.apiFetch('/api/accounts/shared-with-me');
        return accounts.filter(a => String(a.ownerId) === String(forId) && a.role === 'readwrite');
    }

    // "Transfer to" always excludes whichever account is currently picked
    // in the Account field above it — same reasoning as the register's own
    // txn-transfer-account, and re-run whenever that field changes (see the
    // sched-account listener in init() below) since this form lets you pick
    // the account, unlike the register where it's fixed to the page you're on.
    function populateTransferAccountOptions() {
        const currentAccount = document.getElementById('sched-account').value;
        document.getElementById('sched-transfer-account').innerHTML = accounts
            .filter(a => a.id !== currentAccount)
            .map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    }

    // Same exclusion as populateTransferAccountOptions above, and re-run at
    // the same times (account change, load) — see its own comment.
    function populateAutopayFromAccountOptions() {
        const currentAccount = document.getElementById('sched-account').value;
        document.getElementById('sched-autopay-from-account').innerHTML = '<option value="">— same account —</option>' + accounts
            .filter(a => a.id !== currentAccount)
            .map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    }

    // Shared by load() and resolveCategorySelection() below (the latter
    // re-populates after creating a category inline, so it shows up without
    // a full page reload).
    function populateCategoryOptions() {
        document.getElementById('sched-category').innerHTML =
            '<option value="">— none —</option>' +
            categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('') +
            '<option value="__new__">+ Create new category…</option>';
    }

    // Human-readable "Repeats" text for all three recurrence kinds — shared
    // by row()'s table cell and matchesFilters' live filter below, so what
    // you type against always matches what's actually displayed.
    const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const ORDINAL_LABELS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', '-1': 'last' };
    function dayOfMonthLabel(day) {
        if (day === -1) return 'last day';
        if (day === 1 || day === 21 || day === 31) return `${day}st`;
        if (day === 2 || day === 22) return `${day}nd`;
        if (day === 3 || day === 23) return `${day}rd`;
        return `${day}th`;
    }
    function frequencyText(frequency) {
        if (frequency.kind === 'ordinalWeekday') {
            const ordinals = frequency.ordinals.map((o) => ORDINAL_LABELS[o] || o).join(' & ');
            return `${ordinals} ${WEEKDAY_NAMES[frequency.weekday]} of the month`;
        }
        if (frequency.kind === 'dayOfMonth') {
            return `${dayOfMonthLabel(frequency.day)} of the month`;
        }
        return `every ${frequency.interval} ${frequency.unit}`;
    }

    function row(schedule) {
        const tr = document.createElement('tr');
        const account = accounts.find(a => a.id === schedule.account);
        const amountClass = schedule.amountCents < 0 ? 'money-negative' : 'money-positive';
        // A transfer schedule has no payee/category (server clears them —
        // see controllers/schedulesController.js) — show where it's going
        // across both columns instead, same "Transfer" idea the register's
        // own transactionRow() uses for posted transfers.
        const payeeCell = schedule.transferAccount ? `→ ${schedule.transferAccount.name}` : (schedule.payee ? schedule.payee.name : '');
        const categoryCell = schedule.transferAccount ? 'Transfer' : (schedule.category ? schedule.category.name : '');
        const autopayTitle = schedule.autopayFromAccount ? `Autopay — drafted from ${schedule.autopayFromAccount.name}` : 'Autopay';
        const badgeColors = preferences.badgeColors || {};
        const dueSoonStyle = window.BWBadgeColor.badgeStyle(badgeColors.due);
        const autopayStyle = window.BWBadgeColor.badgeStyle(badgeColors.autopay);
        tr.innerHTML = `
            <td>${schedule.name}${schedule.dueSoon ? ` <span class="badge badge-warn" style="${dueSoonStyle}">Due soon</span>` : ''}${schedule.notifyByEmail ? ' <span class="badge" title="Emails everyone with a mail server configured when due">✉</span>' : ''}${schedule.autopay ? ` <span class="badge" style="${autopayStyle}" title="${autopayTitle}">⟳ Autopay</span>` : ''}</td>
            <td>${account ? account.name : ''}</td>
            <td>${payeeCell}</td>
            <td class="money ${amountClass}">${window.BWMoney.formatCents(schedule.amountCents)}</td>
            <td>${categoryCell}</td>
            <td>${window.BWDate.formatDate(schedule.nextDate)}</td>
            <td>${frequencyText(schedule.frequency)}</td>
            <td><input type="checkbox" data-auto-toggle ${schedule.autoEnter ? 'checked' : ''}></td>
            <td class="row-actions">
                <button type="button" class="btn btn-secondary btn-sm icon-btn" data-edit title="Edit">✎</button>
                <button type="button" class="btn btn-danger btn-sm icon-btn" data-delete title="Delete">🗑</button>
            </td>
        `;
        tr.querySelector('[data-auto-toggle]').addEventListener('change', async (e) => {
            try {
                await window.BWApi.apiFetch(`/api/schedules/${schedule.id}`, { method: 'PUT', body: { autoEnter: e.target.checked } });
            } catch (err) {
                e.target.checked = !e.target.checked;
                showError(err);
            }
        });
        tr.querySelector('[data-edit]').addEventListener('click', () => startEdit(schedule));
        tr.querySelector('[data-delete]').addEventListener('click', async () => {
            if (!confirm(`Delete schedule "${schedule.name}"?`)) return;
            try {
                await window.BWApi.apiFetch(`/api/schedules/${schedule.id}`, { method: 'DELETE' });
                load();
            } catch (err) {
                showError(err);
            }
        });
        return tr;
    }

    // Matches against the same text the table cells themselves show, so
    // what you type lines up with what you're reading.
    function matchesFilters(schedule) {
        const f = filterState;
        const account = accounts.find(a => a.id === schedule.account);
        if (f.name && !schedule.name.toLowerCase().includes(f.name)) return false;
        if (f.account && !(account ? account.name : '').toLowerCase().includes(f.account)) return false;
        const payeeText = schedule.transferAccount ? `transfer ${schedule.transferAccount.name}` : (schedule.payee ? schedule.payee.name : '');
        if (f.payee && !payeeText.toLowerCase().includes(f.payee)) return false;
        if (f.amount && !(schedule.amountCents / 100).toFixed(2).includes(f.amount)) return false;
        const categoryText = schedule.transferAccount ? 'transfer' : (schedule.category ? schedule.category.name : '');
        if (f.category && !categoryText.toLowerCase().includes(f.category)) return false;
        if (f.nextdate && !window.BWDate.formatDate(schedule.nextDate).toLowerCase().includes(f.nextdate)) return false;
        const repeatsText = frequencyText(schedule.frequency);
        if (f.repeats && !repeatsText.toLowerCase().includes(f.repeats)) return false;
        return true;
    }

    function renderSchedulesTable() {
        tbody.innerHTML = '';
        if (currentSchedules.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No schedules yet.</td></tr>';
            return;
        }
        const filtered = currentSchedules.filter(matchesFilters);
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No schedules match your filters.</td></tr>';
            return;
        }
        filtered.forEach(s => tbody.appendChild(row(s)));
    }

    async function load() {
        try {
            const [schedulesRes, accountOptions, categoriesRes, categoryGroupsRes, payeesRes, prefsRes] = await Promise.all([
                window.BWApi.apiFetch(`/api/schedules${forQuery()}`),
                loadAccountOptions(),
                window.BWApi.apiFetch(`/api/categories${forQuery()}`),
                window.BWApi.apiFetch(`/api/category-groups${forQuery()}`),
                window.BWApi.apiFetch(`/api/payees${forQuery()}`),
                window.BWApi.apiFetch('/api/auth/preferences')
            ]);
            accounts = accountOptions;
            preferences.badgeColors = prefsRes.badgeColors || preferences.badgeColors;
            categories = categoriesRes.categories;
            categoryGroups = categoryGroupsRes.categoryGroups;
            payees = payeesRes.payees;
            document.getElementById('sched-account').innerHTML = accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
            populateCategoryOptions();
            document.getElementById('sched-new-category-group-select').innerHTML =
                '<option value="">— pick a group —</option>' + categoryGroups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
            document.getElementById('sched-payee-options').innerHTML = payees.map(p => `<option value="${p.name}">`).join('');
            populateTransferAccountOptions();
            populateAutopayFromAccountOptions();

            currentSchedules = schedulesRes.schedules;
            renderSchedulesTable();
        } catch (err) {
            showError(err);
        }
    }

    // ── Live filter row — narrows #schedules-tbody as you type, no re-fetch.
    const SCHED_FILTER_FIELDS = ['name', 'account', 'payee', 'amount', 'category', 'nextdate', 'repeats'];
    SCHED_FILTER_FIELDS.forEach((field) => {
        document.getElementById(`sched-filter-${field}`).addEventListener('input', (e) => {
            filterState[field] = e.target.value.trim().toLowerCase();
            renderSchedulesTable();
        });
    });
    document.getElementById('sched-filter-clear-btn').addEventListener('click', () => {
        SCHED_FILTER_FIELDS.forEach((field) => {
            filterState[field] = '';
            document.getElementById(`sched-filter-${field}`).value = '';
        });
        renderSchedulesTable();
    });

    // Same create-if-missing pattern as the register's resolvePayee.
    async function resolvePayee(name) {
        if (!name) return null;
        const existing = payees.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing.id;
        try {
            const created = await window.BWApi.apiFetch(`/api/payees${forQuery()}`, { method: 'POST', body: { name } });
            payees.push(created);
            return created.id;
        } catch (err) {
            const refreshed = await window.BWApi.apiFetch(`/api/payees${forQuery()}`);
            payees = refreshed.payees;
            const match = payees.find(p => p.name.toLowerCase() === name.toLowerCase());
            return match ? match.id : null;
        }
    }

    // Reads #sched-category — a plain existing-category id, or (when
    // "+ Create new category…" is selected) creates one from the name/group
    // fields revealed below it and returns the new id. Mirrors budget.js's
    // inline "+ category" prompt, just as a form field instead of a prompt().
    async function resolveCategorySelection() {
        const value = document.getElementById('sched-category').value;
        if (value !== '__new__') return value || null;
        const name = document.getElementById('sched-new-category-name').value.trim();
        const groupId = document.getElementById('sched-new-category-group-select').value;
        if (!name) throw new Error('Enter a name for the new category');
        if (!groupId) throw new Error('Pick a group for the new category');
        const created = await window.BWApi.apiFetch(`/api/categories${forQuery()}`, { method: 'POST', body: { name, group: groupId } });
        categories.push(created);
        populateCategoryOptions();
        document.getElementById('sched-category').value = created.id;
        return created.id;
    }

    document.getElementById('sched-category').addEventListener('change', (e) => {
        const isNew = e.target.value === '__new__';
        document.getElementById('sched-new-category-fields').hidden = !isNew;
        if (!isNew) {
            document.getElementById('sched-new-category-name').value = '';
            document.getElementById('sched-new-category-group-select').value = '';
        }
    });

    // Shared by startEdit and resetForm — populates every frequency-related
    // field (kind select, and whichever of interval/unit, weekday+ordinal
    // checkboxes, or day-of-month applies) and toggles the three
    // mode-specific groups + the next-date hint, so the two callers can't
    // drift out of sync with each other.
    function applyFrequencyToForm(frequency) {
        const kind = ['ordinalWeekday', 'dayOfMonth'].includes(frequency.kind) ? frequency.kind : 'interval';
        document.getElementById('sched-freq-kind').value = kind;
        document.getElementById('sched-interval-group').hidden = kind !== 'interval';
        document.getElementById('sched-ordinal-weekday-group').hidden = kind !== 'ordinalWeekday';
        document.getElementById('sched-day-of-month-group').hidden = kind !== 'dayOfMonth';
        document.getElementById('sched-next-date-hint').hidden = kind === 'interval';

        document.getElementById('sched-interval').value = kind === 'interval' ? frequency.interval : 1;
        document.getElementById('sched-unit').value = kind === 'interval' ? frequency.unit : 'months';

        document.getElementById('sched-weekday').value = kind === 'ordinalWeekday' ? frequency.weekday : 3;
        const ordinals = kind === 'ordinalWeekday' ? frequency.ordinals.map(String) : [];
        document.querySelectorAll('.sched-ordinal-checkbox').forEach((cb) => {
            cb.checked = ordinals.includes(cb.value);
        });

        document.getElementById('sched-day-of-month').value = kind === 'dayOfMonth' ? frequency.day : 1;
    }

    function startEdit(schedule) {
        editingId = schedule.id;
        document.getElementById('schedule-form-title').textContent = `Edit ${schedule.name}`;
        document.getElementById('sched-name').value = schedule.name;
        document.getElementById('sched-account').value = schedule.account;
        document.getElementById('sched-amount').value = (schedule.amountCents / 100).toFixed(2);
        populateTransferAccountOptions();
        populateAutopayFromAccountOptions();
        document.getElementById('sched-is-transfer').checked = !!schedule.transferAccount;
        document.getElementById('sched-transfer-group').hidden = !schedule.transferAccount;
        document.getElementById('sched-category-group').hidden = !!schedule.transferAccount;
        document.getElementById('sched-transfer-account').value = schedule.transferAccount ? schedule.transferAccount.id : '';
        document.getElementById('sched-autopay').checked = !!schedule.autopay;
        document.getElementById('sched-autopay-from-group').hidden = !schedule.autopay || !!schedule.transferAccount;
        document.getElementById('sched-autopay-from-account').value = schedule.autopayFromAccount ? schedule.autopayFromAccount.id : '';
        document.getElementById('sched-payee').value = schedule.payee ? schedule.payee.name : '';
        document.getElementById('sched-category').value = schedule.category ? schedule.category.id : '';
        document.getElementById('sched-new-category-fields').hidden = true;
        document.getElementById('sched-next-date').value = window.BWDate.toDateInputValue(schedule.nextDate);
        document.getElementById('sched-end-date').value = schedule.endDate ? window.BWDate.toDateInputValue(schedule.endDate) : '';
        applyFrequencyToForm(schedule.frequency);
        document.getElementById('sched-reminder').value = schedule.reminderDaysBefore;
        document.getElementById('sched-notes').value = schedule.notes || '';
        document.getElementById('sched-auto-enter').checked = schedule.autoEnter;
        document.getElementById('sched-notify-email').checked = schedule.notifyByEmail;
        form.hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function resetForm() {
        editingId = null;
        document.getElementById('schedule-form-title').textContent = 'New schedule';
        document.getElementById('sched-name').value = '';
        document.getElementById('sched-account').value = accounts[0] ? accounts[0].id : '';
        document.getElementById('sched-amount').value = '';
        document.getElementById('sched-is-transfer').checked = false;
        document.getElementById('sched-transfer-group').hidden = true;
        document.getElementById('sched-category-group').hidden = false;
        populateTransferAccountOptions();
        document.getElementById('sched-transfer-account').value = '';
        document.getElementById('sched-autopay').checked = false;
        document.getElementById('sched-autopay-from-group').hidden = true;
        populateAutopayFromAccountOptions();
        document.getElementById('sched-autopay-from-account').value = '';
        document.getElementById('sched-payee').value = '';
        document.getElementById('sched-category').value = '';
        document.getElementById('sched-new-category-fields').hidden = true;
        document.getElementById('sched-new-category-name').value = '';
        document.getElementById('sched-new-category-group-select').value = '';
        document.getElementById('sched-next-date').value = '';
        document.getElementById('sched-end-date').value = '';
        applyFrequencyToForm({ kind: 'interval', interval: 1, unit: 'months' });
        document.getElementById('sched-reminder').value = '3';
        document.getElementById('sched-notes').value = '';
        document.getElementById('sched-auto-enter').checked = false;
        document.getElementById('sched-notify-email').checked = false;
        form.hidden = true;
    }

    document.getElementById('new-schedule-btn').addEventListener('click', () => {
        if (!form.hidden && !editingId) { resetForm(); return; }
        resetForm();
        form.hidden = false;
    });
    document.getElementById('cancel-schedule-btn').addEventListener('click', resetForm);

    document.getElementById('sched-account').addEventListener('change', () => {
        populateTransferAccountOptions();
        populateAutopayFromAccountOptions();
    });
    document.getElementById('sched-is-transfer').addEventListener('change', (e) => {
        document.getElementById('sched-transfer-group').hidden = !e.target.checked;
        document.getElementById('sched-category-group').hidden = e.target.checked;
        // autopayFromAccount is mutually exclusive with transferAccount
        // (see controllers/schedulesController.js) — hide it here too so the
        // form doesn't offer a combination the server will silently clear.
        document.getElementById('sched-autopay-from-group').hidden = e.target.checked || !document.getElementById('sched-autopay').checked;
    });
    document.getElementById('sched-autopay').addEventListener('change', (e) => {
        document.getElementById('sched-autopay-from-group').hidden = !e.target.checked || document.getElementById('sched-is-transfer').checked;
    });
    document.getElementById('sched-freq-kind').addEventListener('change', (e) => {
        const kind = e.target.value;
        document.getElementById('sched-interval-group').hidden = kind !== 'interval';
        document.getElementById('sched-ordinal-weekday-group').hidden = kind !== 'ordinalWeekday';
        document.getElementById('sched-day-of-month-group').hidden = kind !== 'dayOfMonth';
        document.getElementById('sched-next-date-hint').hidden = kind === 'interval';
    });

    document.getElementById('save-schedule-btn').addEventListener('click', async () => {
        const name = document.getElementById('sched-name').value.trim();
        const amountCents = window.BWMoney.toCents(document.getElementById('sched-amount').value || 0);
        const nextDate = document.getElementById('sched-next-date').value;
        if (!name || !amountCents || !nextDate) return showError(new Error('Name, amount, and next date are required'));
        const isTransfer = document.getElementById('sched-is-transfer').checked;
        if (isTransfer && !document.getElementById('sched-transfer-account').value) {
            return showError(new Error('Pick which account this transfers to'));
        }
        const freqKind = document.getElementById('sched-freq-kind').value;
        const ordinals = [...document.querySelectorAll('.sched-ordinal-checkbox:checked')].map((cb) => Number(cb.value));
        if (freqKind === 'ordinalWeekday' && ordinals.length === 0) {
            return showError(new Error('Pick at least one occurrence (1st, 2nd, 3rd, 4th, or last)'));
        }

        let frequency;
        if (freqKind === 'ordinalWeekday') {
            frequency = { kind: 'ordinalWeekday', weekday: Number(document.getElementById('sched-weekday').value), ordinals };
        } else if (freqKind === 'dayOfMonth') {
            frequency = { kind: 'dayOfMonth', day: Number(document.getElementById('sched-day-of-month').value) };
        } else {
            frequency = {
                kind: 'interval',
                interval: Number(document.getElementById('sched-interval').value) || 1,
                unit: document.getElementById('sched-unit').value
            };
        }

        try {
            const body = {
                name,
                account: document.getElementById('sched-account').value,
                amountCents,
                nextDate,
                endDate: document.getElementById('sched-end-date').value || null,
                frequency,
                reminderDaysBefore: Number(document.getElementById('sched-reminder').value) || 0,
                notes: document.getElementById('sched-notes').value,
                autoEnter: document.getElementById('sched-auto-enter').checked,
                notifyByEmail: document.getElementById('sched-notify-email').checked
            };
            body.autopay = document.getElementById('sched-autopay').checked;
            if (isTransfer) {
                body.transferAccount = document.getElementById('sched-transfer-account').value;
                body.payee = null;
                body.category = null;
                body.autopayFromAccount = null;
            } else {
                body.transferAccount = null;
                body.payee = await resolvePayee(document.getElementById('sched-payee').value.trim());
                body.category = await resolveCategorySelection();
                body.autopayFromAccount = body.autopay ? (document.getElementById('sched-autopay-from-account').value || null) : null;
            }
            if (editingId) {
                await window.BWApi.apiFetch(`/api/schedules/${editingId}`, { method: 'PUT', body });
            } else {
                await window.BWApi.apiFetch('/api/schedules', { method: 'POST', body });
            }
            resetForm();
            load();
        } catch (err) {
            showError(err);
        }
    });

    (async function init() {
        ownerSwitcher = await window.BWOwnerSwitcher.init(() => {
            resetForm();
            load();
        });
        load();
    })();
})();
