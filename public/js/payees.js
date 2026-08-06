(function () {
    const tbody = document.getElementById('payees-tbody');
    if (!tbody) return;
    const errorBox = document.getElementById('payees-error');
    const form = document.getElementById('payee-form');
    let categories = [];
    let editingId = null;
    let ownerSwitcher = { forOwnerId: () => null };

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    // Appended to every fetch/write below — a no-op (?for=) when managing
    // your own data, or the "Managing: [owner]" switcher's current
    // selection (see public/js/ownerSwitcher.js).
    function forQuery() {
        const id = ownerSwitcher.forOwnerId();
        return id ? `?for=${id}` : '';
    }

    function categoryOptionsHtml(selectedId) {
        return '<option value="">— none —</option>' + categories
            .map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.name}</option>`).join('');
    }

    function row(payee) {
        const tr = document.createElement('tr');
        const defaultCategory = categories.find(c => c.id === payee.defaultCategory);
        tr.innerHTML = `
            <td>${payee.name}</td>
            <td>${defaultCategory ? defaultCategory.name : ''}</td>
            <td>${payee.phone || ''}</td>
            <td class="wrap">${payee.address || ''}</td>
            <td>${payee.accountNumber || ''}</td>
            <td class="row-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-edit>Edit</button>
                <button type="button" class="btn btn-danger btn-sm" data-delete>Delete</button>
            </td>
        `;
        tr.querySelector('[data-edit]').addEventListener('click', () => startEdit(payee));
        tr.querySelector('[data-delete]').addEventListener('click', async () => {
            if (!confirm(`Delete payee "${payee.name}"?`)) return;
            try {
                await window.BWApi.apiFetch(`/api/payees/${payee.id}${forQuery()}`, { method: 'DELETE' });
                load();
            } catch (err) {
                showError(err);
            }
        });
        return tr;
    }

    async function load() {
        try {
            const [payeesRes, categoriesRes] = await Promise.all([
                window.BWApi.apiFetch(`/api/payees${forQuery()}`),
                window.BWApi.apiFetch(`/api/categories${forQuery()}`)
            ]);
            categories = categoriesRes.categories;
            document.getElementById('payee-default-category').innerHTML = categoryOptionsHtml();
            tbody.innerHTML = '';
            if (payeesRes.payees.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No payees yet.</td></tr>';
                return;
            }
            payeesRes.payees.forEach(p => tbody.appendChild(row(p)));
        } catch (err) {
            showError(err);
        }
    }

    function startEdit(payee) {
        editingId = payee.id;
        document.getElementById('payee-form-title').textContent = `Edit ${payee.name}`;
        document.getElementById('payee-name').value = payee.name;
        document.getElementById('payee-default-category').innerHTML = categoryOptionsHtml(payee.defaultCategory);
        document.getElementById('payee-phone').value = payee.phone || '';
        document.getElementById('payee-address').value = payee.address || '';
        document.getElementById('payee-account-number').value = payee.accountNumber || '';
        form.hidden = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function resetForm() {
        editingId = null;
        document.getElementById('payee-form-title').textContent = 'New payee';
        document.getElementById('payee-name').value = '';
        document.getElementById('payee-default-category').innerHTML = categoryOptionsHtml();
        document.getElementById('payee-phone').value = '';
        document.getElementById('payee-address').value = '';
        document.getElementById('payee-account-number').value = '';
        form.hidden = true;
    }

    document.getElementById('new-payee-btn').addEventListener('click', () => {
        if (!form.hidden && !editingId) { resetForm(); return; }
        resetForm();
        form.hidden = false;
    });
    document.getElementById('cancel-payee-btn').addEventListener('click', resetForm);
    document.getElementById('save-payee-btn').addEventListener('click', async () => {
        const name = document.getElementById('payee-name').value.trim();
        if (!name) return;
        const body = {
            name,
            defaultCategory: document.getElementById('payee-default-category').value || null,
            phone: document.getElementById('payee-phone').value.trim(),
            address: document.getElementById('payee-address').value.trim(),
            accountNumber: document.getElementById('payee-account-number').value.trim()
        };
        try {
            if (editingId) {
                await window.BWApi.apiFetch(`/api/payees/${editingId}${forQuery()}`, { method: 'PUT', body });
            } else {
                await window.BWApi.apiFetch(`/api/payees${forQuery()}`, { method: 'POST', body });
            }
            resetForm();
            load();
        } catch (err) {
            showError(err);
        }
    });

    (async function init() {
        ownerSwitcher = await window.BWOwnerSwitcher.init((forOwnerId) => {
            resetForm();
            load();
        });
        load();
    })();
})();
