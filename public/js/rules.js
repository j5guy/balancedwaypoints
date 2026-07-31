(function () {
    const tbody = document.getElementById('rules-tbody');
    if (!tbody) return;
    const errorBox = document.getElementById('rules-error');
    const newForm = document.getElementById('new-rule-form');
    let categories = [];

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function conditionRow(field, operator, value) {
        const div = document.createElement('div');
        div.className = 'split-row';
        div.innerHTML = `
            <select class="cond-field">
                <option value="payee">Payee</option>
                <option value="notes">Notes</option>
                <option value="amountCents">Amount (cents)</option>
            </select>
            <select class="cond-operator">
                <option value="contains">contains</option>
                <option value="equals">equals</option>
                <option value="startsWith">starts with</option>
                <option value="greaterThan">greater than</option>
                <option value="lessThan">less than</option>
            </select>
            <input type="text" class="cond-value" placeholder="value">
            <button type="button" class="btn btn-danger btn-sm" data-remove>&times;</button>
        `;
        if (field) div.querySelector('.cond-field').value = field;
        if (operator) div.querySelector('.cond-operator').value = operator;
        if (value !== undefined) div.querySelector('.cond-value').value = value;
        div.querySelector('[data-remove]').addEventListener('click', () => div.remove());
        return div;
    }

    function actionRow(type, value) {
        const div = document.createElement('div');
        div.className = 'split-row';
        div.innerHTML = `
            <select class="action-type">
                <option value="setCategory">Set category to</option>
                <option value="renamePayee">Rename payee to</option>
                <option value="addTag">Add tag</option>
            </select>
            <select class="action-value-category">${categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select>
            <input type="text" class="action-value-text" placeholder="value" hidden>
            <button type="button" class="btn btn-danger btn-sm" data-remove>&times;</button>
        `;
        const typeSelect = div.querySelector('.action-type');
        const categorySelect = div.querySelector('.action-value-category');
        const textInput = div.querySelector('.action-value-text');
        function syncVisibility() {
            const isCategory = typeSelect.value === 'setCategory';
            categorySelect.hidden = !isCategory;
            textInput.hidden = isCategory;
        }
        typeSelect.addEventListener('change', syncVisibility);
        if (type) typeSelect.value = type;
        syncVisibility();
        if (value !== undefined) {
            if (typeSelect.value === 'setCategory') categorySelect.value = value;
            else textInput.value = value;
        }
        div.querySelector('[data-remove]').addEventListener('click', () => div.remove());
        return div;
    }

    document.getElementById('add-condition-btn').addEventListener('click', () => {
        document.getElementById('conditions-list').appendChild(conditionRow());
    });
    document.getElementById('add-action-btn').addEventListener('click', () => {
        document.getElementById('actions-list').appendChild(actionRow());
    });
    document.getElementById('new-rule-btn').addEventListener('click', () => { newForm.hidden = !newForm.hidden; });
    document.getElementById('cancel-rule-btn').addEventListener('click', () => { newForm.hidden = true; });

    function readConditions() {
        return [...document.querySelectorAll('#conditions-list .split-row')].map(row => ({
            field: row.querySelector('.cond-field').value,
            operator: row.querySelector('.cond-operator').value,
            value: row.querySelector('.cond-value').value
        })).filter(c => c.value !== '');
    }

    function readActions() {
        return [...document.querySelectorAll('#actions-list .split-row')].map(row => {
            const type = row.querySelector('.action-type').value;
            const value = type === 'setCategory' ? row.querySelector('.action-value-category').value : row.querySelector('.action-value-text').value;
            return { type, value };
        }).filter(a => a.value);
    }

    function describeConditions(conditions) {
        return conditions.map(c => `${c.field} ${c.operator} "${c.value}"`).join(' AND ');
    }
    function describeActions(actions) {
        return actions.map(a => {
            if (a.type === 'setCategory') {
                const cat = categories.find(c => c.id === a.value);
                return `set category → ${cat ? cat.name : a.value}`;
            }
            if (a.type === 'renamePayee') return `rename payee → "${a.value}"`;
            return `add tag "${a.value}"`;
        }).join(', ');
    }

    function row(rule) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${rule.priority}</td>
            <td>${rule.name}</td>
            <td class="wrap">${describeConditions(rule.conditions)}</td>
            <td class="wrap">${describeActions(rule.actions)}</td>
            <td><input type="checkbox" data-active-toggle ${rule.active ? 'checked' : ''}></td>
            <td class="row-actions"><button type="button" class="btn btn-danger btn-sm" data-delete>Delete</button></td>
        `;
        tr.querySelector('[data-active-toggle]').addEventListener('change', async (e) => {
            try {
                await window.BWApi.apiFetch(`/api/rules/${rule.id}`, { method: 'PUT', body: { active: e.target.checked } });
            } catch (err) {
                e.target.checked = !e.target.checked;
                showError(err);
            }
        });
        tr.querySelector('[data-delete]').addEventListener('click', async () => {
            if (!confirm(`Delete rule "${rule.name}"?`)) return;
            try {
                await window.BWApi.apiFetch(`/api/rules/${rule.id}`, { method: 'DELETE' });
                load();
            } catch (err) {
                showError(err);
            }
        });
        return tr;
    }

    async function load() {
        try {
            const [rulesRes, categoriesRes] = await Promise.all([
                window.BWApi.apiFetch('/api/rules'),
                window.BWApi.apiFetch('/api/categories')
            ]);
            categories = categoriesRes.categories;
            tbody.innerHTML = '';
            if (rulesRes.rules.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No rules yet.</td></tr>';
                return;
            }
            rulesRes.rules.sort((a, b) => a.priority - b.priority).forEach(r => tbody.appendChild(row(r)));
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('save-rule-btn').addEventListener('click', async () => {
        const name = document.getElementById('rule-name').value.trim();
        if (!name) return showError(new Error('Name is required'));
        try {
            await window.BWApi.apiFetch('/api/rules', {
                method: 'POST',
                body: {
                    name,
                    priority: Number(document.getElementById('rule-priority').value) || 0,
                    stopProcessing: document.getElementById('rule-stop').checked,
                    conditions: readConditions(),
                    actions: readActions()
                }
            });
            newForm.hidden = true;
            document.getElementById('rule-name').value = '';
            document.getElementById('conditions-list').innerHTML = '';
            document.getElementById('actions-list').innerHTML = '';
            load();
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
