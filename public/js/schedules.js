(function () {
    const tbody = document.getElementById('schedules-tbody');
    if (!tbody) return;
    const errorBox = document.getElementById('schedules-error');
    const newForm = document.getElementById('new-schedule-form');
    let accounts = [];
    let categories = [];

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function row(schedule) {
        const tr = document.createElement('tr');
        const account = accounts.find(a => a.id === schedule.account);
        const amountClass = schedule.amountCents < 0 ? 'money-negative' : 'money-positive';
        tr.innerHTML = `
            <td>${schedule.name}${schedule.dueSoon ? ' <span class="badge badge-warn">Due soon</span>' : ''}</td>
            <td>${account ? account.name : ''}</td>
            <td class="money ${amountClass}">${window.BWMoney.formatCents(schedule.amountCents)}</td>
            <td>${schedule.category ? schedule.category.name : ''}</td>
            <td>${new Date(schedule.nextDate).toLocaleDateString()}</td>
            <td>every ${schedule.frequency.interval} ${schedule.frequency.unit}</td>
            <td><input type="checkbox" data-auto-toggle ${schedule.autoEnter ? 'checked' : ''}></td>
            <td class="row-actions"><button type="button" class="btn btn-danger btn-sm" data-delete>Delete</button></td>
        `;
        tr.querySelector('[data-auto-toggle]').addEventListener('change', async (e) => {
            try {
                await window.BWApi.apiFetch(`/api/schedules/${schedule.id}`, { method: 'PUT', body: { autoEnter: e.target.checked } });
            } catch (err) {
                e.target.checked = !e.target.checked;
                showError(err);
            }
        });
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
            const [schedulesRes, accountsRes, categoriesRes] = await Promise.all([
                window.BWApi.apiFetch('/api/schedules'),
                window.BWApi.apiFetch('/api/accounts'),
                window.BWApi.apiFetch('/api/categories')
            ]);
            accounts = accountsRes.accounts;
            categories = categoriesRes.categories;
            document.getElementById('sched-account').innerHTML = accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
            document.getElementById('sched-category').innerHTML = '<option value="">— none —</option>' + categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

            tbody.innerHTML = '';
            if (schedulesRes.schedules.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No schedules yet.</td></tr>';
                return;
            }
            schedulesRes.schedules.forEach(s => tbody.appendChild(row(s)));
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('new-schedule-btn').addEventListener('click', () => { newForm.hidden = !newForm.hidden; });
    document.getElementById('cancel-schedule-btn').addEventListener('click', () => { newForm.hidden = true; });
    document.getElementById('save-schedule-btn').addEventListener('click', async () => {
        const name = document.getElementById('sched-name').value.trim();
        const amountCents = window.BWMoney.toCents(document.getElementById('sched-amount').value || 0);
        const nextDate = document.getElementById('sched-next-date').value;
        if (!name || !amountCents || !nextDate) return showError(new Error('Name, amount, and next date are required'));

        try {
            await window.BWApi.apiFetch('/api/schedules', {
                method: 'POST',
                body: {
                    name,
                    account: document.getElementById('sched-account').value,
                    amountCents,
                    category: document.getElementById('sched-category').value || null,
                    nextDate,
                    endDate: document.getElementById('sched-end-date').value || null,
                    frequency: {
                        interval: Number(document.getElementById('sched-interval').value) || 1,
                        unit: document.getElementById('sched-unit').value
                    },
                    reminderDaysBefore: Number(document.getElementById('sched-reminder').value) || 0,
                    autoEnter: document.getElementById('sched-auto-enter').checked
                }
            });
            newForm.hidden = true;
            load();
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
