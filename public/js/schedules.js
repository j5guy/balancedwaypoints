(function () {
    const tbody = document.getElementById('schedules-tbody');
    if (!tbody) return;
    const errorBox = document.getElementById('schedules-error');
    const form = document.getElementById('schedule-form');
    let accounts = [];
    let categories = [];
    let payees = [];
    let editingId = null;

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function row(schedule) {
        const tr = document.createElement('tr');
        const account = accounts.find(a => a.id === schedule.account);
        const amountClass = schedule.amountCents < 0 ? 'money-negative' : 'money-positive';
        tr.innerHTML = `
            <td>${schedule.name}${schedule.dueSoon ? ' <span class="badge badge-warn">Due soon</span>' : ''}${schedule.notifyByEmail ? ' <span class="badge" title="Emails everyone with a mail server configured when due">✉</span>' : ''}</td>
            <td>${account ? account.name : ''}</td>
            <td>${schedule.payee ? schedule.payee.name : ''}</td>
            <td class="money ${amountClass}">${window.BWMoney.formatCents(schedule.amountCents)}</td>
            <td>${schedule.category ? schedule.category.name : ''}</td>
            <td>${new Date(schedule.nextDate).toLocaleDateString()}</td>
            <td>every ${schedule.frequency.interval} ${schedule.frequency.unit}</td>
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

    async function load() {
        try {
            const [schedulesRes, accountsRes, categoriesRes, payeesRes] = await Promise.all([
                window.BWApi.apiFetch('/api/schedules'),
                window.BWApi.apiFetch('/api/accounts'),
                window.BWApi.apiFetch('/api/categories'),
                window.BWApi.apiFetch('/api/payees')
            ]);
            accounts = accountsRes.accounts;
            categories = categoriesRes.categories;
            payees = payeesRes.payees;
            document.getElementById('sched-account').innerHTML = accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
            document.getElementById('sched-category').innerHTML = '<option value="">— none —</option>' + categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            document.getElementById('sched-payee-options').innerHTML = payees.map(p => `<option value="${p.name}">`).join('');

            tbody.innerHTML = '';
            if (schedulesRes.schedules.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No schedules yet.</td></tr>';
                return;
            }
            schedulesRes.schedules.forEach(s => tbody.appendChild(row(s)));
        } catch (err) {
            showError(err);
        }
    }

    // Same create-if-missing pattern as the register's resolvePayee.
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

    function startEdit(schedule) {
        editingId = schedule.id;
        document.getElementById('schedule-form-title').textContent = `Edit ${schedule.name}`;
        document.getElementById('sched-name').value = schedule.name;
        document.getElementById('sched-account').value = schedule.account;
        document.getElementById('sched-amount').value = (schedule.amountCents / 100).toFixed(2);
        document.getElementById('sched-payee').value = schedule.payee ? schedule.payee.name : '';
        document.getElementById('sched-category').value = schedule.category ? schedule.category.id : '';
        document.getElementById('sched-next-date').value = new Date(schedule.nextDate).toISOString().slice(0, 10);
        document.getElementById('sched-end-date').value = schedule.endDate ? new Date(schedule.endDate).toISOString().slice(0, 10) : '';
        document.getElementById('sched-interval').value = schedule.frequency.interval;
        document.getElementById('sched-unit').value = schedule.frequency.unit;
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
        document.getElementById('sched-payee').value = '';
        document.getElementById('sched-category').value = '';
        document.getElementById('sched-next-date').value = '';
        document.getElementById('sched-end-date').value = '';
        document.getElementById('sched-interval').value = '1';
        document.getElementById('sched-unit').value = 'months';
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
    document.getElementById('save-schedule-btn').addEventListener('click', async () => {
        const name = document.getElementById('sched-name').value.trim();
        const amountCents = window.BWMoney.toCents(document.getElementById('sched-amount').value || 0);
        const nextDate = document.getElementById('sched-next-date').value;
        if (!name || !amountCents || !nextDate) return showError(new Error('Name, amount, and next date are required'));

        try {
            const payeeId = await resolvePayee(document.getElementById('sched-payee').value.trim());
            const body = {
                name,
                account: document.getElementById('sched-account').value,
                amountCents,
                payee: payeeId,
                category: document.getElementById('sched-category').value || null,
                nextDate,
                endDate: document.getElementById('sched-end-date').value || null,
                frequency: {
                    interval: Number(document.getElementById('sched-interval').value) || 1,
                    unit: document.getElementById('sched-unit').value
                },
                reminderDaysBefore: Number(document.getElementById('sched-reminder').value) || 0,
                notes: document.getElementById('sched-notes').value,
                autoEnter: document.getElementById('sched-auto-enter').checked,
                notifyByEmail: document.getElementById('sched-notify-email').checked
            };
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

    load();
})();
