(function () {
    const tbody = document.getElementById('payees-tbody');
    if (!tbody) return;
    const errorBox = document.getElementById('payees-error');
    const newForm = document.getElementById('new-payee-form');
    let categories = [];

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
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
            <td class="row-actions"><button type="button" class="btn btn-danger btn-sm" data-delete>Delete</button></td>
        `;
        tr.querySelector('[data-delete]').addEventListener('click', async () => {
            if (!confirm(`Delete payee "${payee.name}"?`)) return;
            try {
                await window.BWApi.apiFetch(`/api/payees/${payee.id}`, { method: 'DELETE' });
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
                window.BWApi.apiFetch('/api/payees'),
                window.BWApi.apiFetch('/api/categories')
            ]);
            categories = categoriesRes.categories;
            document.getElementById('payee-default-category').innerHTML = categoryOptionsHtml();
            tbody.innerHTML = '';
            if (payeesRes.payees.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No payees yet.</td></tr>';
                return;
            }
            payeesRes.payees.forEach(p => tbody.appendChild(row(p)));
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('new-payee-btn').addEventListener('click', () => { newForm.hidden = !newForm.hidden; });
    document.getElementById('cancel-payee-btn').addEventListener('click', () => { newForm.hidden = true; });
    document.getElementById('save-payee-btn').addEventListener('click', async () => {
        const name = document.getElementById('payee-name').value.trim();
        if (!name) return;
        try {
            await window.BWApi.apiFetch('/api/payees', {
                method: 'POST',
                body: { name, defaultCategory: document.getElementById('payee-default-category').value || null }
            });
            newForm.hidden = true;
            document.getElementById('payee-name').value = '';
            load();
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
