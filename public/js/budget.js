(function () {
    const container = document.getElementById('budget-groups');
    if (!container) return;
    const errorBox = document.getElementById('budget-error');

    let month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    let groups = [];
    let allCategories = [];

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function monthLabel(m) {
        const [year, mon] = m.split('-').map(Number);
        return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' });
    }

    function shiftMonth(m, delta) {
        const [year, mon] = m.split('-').map(Number);
        const d = new Date(Date.UTC(year, mon - 1 + delta, 1));
        return d.toISOString().slice(0, 7);
    }

    function groupSection(group, categoryRows) {
        const section = document.createElement('div');
        section.className = 'budget-group';
        section.draggable = true;
        section.dataset.dragId = group.id;
        section.innerHTML = `
            <div class="budget-group-title">
                <span class="drag-handle">⠿</span>${group.name}
                <button type="button" class="btn btn-secondary btn-sm" data-add-category style="margin-left:8px;">+ category</button>
            </div>
            <div class="budget-group-rows"></div>
        `;
        const rowsContainer = section.querySelector('.budget-group-rows');
        categoryRows.forEach(row => rowsContainer.appendChild(categoryRow(row)));
        window.BWDragReorder.makeSortable(rowsContainer, async (ids) => {
            try {
                await Promise.all(ids.map((id, i) => window.BWApi.apiFetch(`/api/categories/${id}`, { method: 'PUT', body: { sortOrder: ids.length - i } })));
            } catch (err) {
                showError(err);
            }
        });
        section.querySelector('[data-add-category]').addEventListener('click', async () => {
            const name = prompt(`New category name in "${group.name}":`);
            if (!name || !name.trim()) return;
            try {
                await window.BWApi.apiFetch('/api/categories', { method: 'POST', body: { name: name.trim(), group: group.id } });
                render();
            } catch (err) {
                showError(err);
            }
        });
        return section;
    }

    function categoryRow(row) {
        const div = document.createElement('div');
        div.className = 'budget-row';
        div.draggable = true;
        div.dataset.dragId = row.category.id;
        const balanceClass = row.balanceCents < 0 ? 'balance-negative' : 'balance-positive';
        div.innerHTML = `
            <span><span class="drag-handle">⠿</span>${row.category.name}
                <button type="button" class="icon-btn" data-delete-category title="Delete category" style="border:none;background:none;cursor:pointer;">🗑</button>
            </span>
            <input type="number" class="assign-input" step="0.01" value="${(row.assignedCents / 100).toFixed(2)}">
            <span class="money">${window.BWMoney.formatCents(row.activityCents)}</span>
            <span class="balance-cell ${balanceClass}">${window.BWMoney.formatCents(row.balanceCents)}</span>
        `;
        const input = div.querySelector('.assign-input');
        input.addEventListener('change', async () => {
            try {
                await window.BWApi.apiFetch(`/api/budgets/${month}/${row.category.id}`, {
                    method: 'PUT',
                    body: { assignedCents: window.BWMoney.toCents(input.value || 0) }
                });
                render();
            } catch (err) {
                showError(err);
            }
        });
        div.querySelector('[data-delete-category]').addEventListener('click', () => openDeleteCategoryModal(row.category));
        return div;
    }

    // Income categories aren't budgetable (no assign/activity/balance
    // columns apply — see services/budget/envelope.js), so this is a much
    // simpler read-mostly list: just names, plus the same "+ category" add
    // affordance the budgetable groups get. No drag-reorder here — ordering
    // income categories isn't worth the complexity for a secondary list.
    function incomeGroupSection(group, categoriesInGroup) {
        const section = document.createElement('div');
        section.className = 'budget-group';
        section.innerHTML = `
            <div class="budget-group-title">
                ${group.name}
                <button type="button" class="btn btn-secondary btn-sm" data-add-category style="margin-left:8px;">+ category</button>
            </div>
            <div class="income-category-list"></div>
        `;
        const list = section.querySelector('.income-category-list');
        if (categoriesInGroup.length === 0) {
            list.innerHTML = '<div class="muted" style="padding:6px 14px;">No categories yet.</div>';
        } else {
            categoriesInGroup.forEach((c) => {
                const row = document.createElement('div');
                row.style.padding = '8px 14px';
                row.style.borderBottom = '1px solid var(--border-light)';
                row.textContent = c.name;
                list.appendChild(row);
            });
        }
        section.querySelector('[data-add-category]').addEventListener('click', async () => {
            const name = prompt(`New income category name in "${group.name}":`);
            if (!name || !name.trim()) return;
            try {
                await window.BWApi.apiFetch('/api/categories', { method: 'POST', body: { name: name.trim(), group: group.id } });
                render();
            } catch (err) {
                showError(err);
            }
        });
        return section;
    }

    async function render() {
        document.getElementById('month-label').textContent = monthLabel(month);
        try {
            const [summary, groupsRes, categoriesRes] = await Promise.all([
                window.BWApi.apiFetch(`/api/budgets/${month}`),
                window.BWApi.apiFetch('/api/category-groups'),
                window.BWApi.apiFetch('/api/categories')
            ]);
            groups = groupsRes.categoryGroups;
            allCategories = categoriesRes.categories;

            const rtaEl = document.getElementById('rta-value');
            const banner = document.getElementById('rta-banner');
            rtaEl.textContent = window.BWMoney.formatCents(summary.readyToAssignCents);
            banner.classList.toggle('rta-negative', summary.readyToAssignCents < 0);

            container.innerHTML = '';
            const budgetGroups = groups.filter(g => !g.isIncome).sort((a, b) => a.sortOrder - b.sortOrder);
            if (budgetGroups.length === 0) {
                container.innerHTML = '<div class="empty-state">No category groups yet — add one above.</div>';
            } else {
                budgetGroups.forEach(group => {
                    const rows = summary.categories.filter(c => c.category.group === group.id);
                    container.appendChild(groupSection(group, rows));
                });
                window.BWDragReorder.makeSortable(container, async (ids) => {
                    try {
                        await Promise.all(ids.map((id, i) => window.BWApi.apiFetch(`/api/category-groups/${id}`, { method: 'PUT', body: { sortOrder: ids.length - i } })));
                    } catch (err) {
                        showError(err);
                    }
                });
            }

            const incomeSection = document.getElementById('income-section');
            const incomeContainer = document.getElementById('income-groups');
            const incomeGroups = groups.filter(g => g.isIncome).sort((a, b) => a.sortOrder - b.sortOrder);
            incomeSection.hidden = incomeGroups.length === 0;
            incomeContainer.innerHTML = '';
            incomeGroups.forEach(group => {
                const cats = allCategories.filter(c => c.group === group.id);
                incomeContainer.appendChild(incomeGroupSection(group, cats));
            });
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('prev-month-btn').addEventListener('click', () => { month = shiftMonth(month, -1); render(); });
    document.getElementById('next-month-btn').addEventListener('click', () => { month = shiftMonth(month, 1); render(); });

    document.getElementById('new-group-btn').addEventListener('click', () => {
        document.getElementById('new-group-form').hidden = !document.getElementById('new-group-form').hidden;
    });
    document.getElementById('cancel-group-btn').addEventListener('click', () => {
        document.getElementById('new-group-form').hidden = true;
    });
    document.getElementById('save-group-btn').addEventListener('click', async () => {
        const name = document.getElementById('group-name').value.trim();
        if (!name) return;
        try {
            await window.BWApi.apiFetch('/api/category-groups', {
                method: 'POST',
                body: { name, isIncome: document.getElementById('group-is-income').checked }
            });
            document.getElementById('new-group-form').hidden = true;
            document.getElementById('group-name').value = '';
            render();
        } catch (err) {
            showError(err);
        }
    });

    // ── Delete category — requires typing the exact name to confirm, and
    // offers to move any transactions currently using it to a replacement
    // category (or to no category, when nothing blocks that — see
    // controllers/categoriesController.js).
    let pendingDeleteCategory = null;
    const deleteOverlay = document.getElementById('delete-category-overlay');
    const deleteConfirmInput = document.getElementById('delete-category-confirm-input');
    const deleteConfirmBtn = document.getElementById('delete-category-confirm-btn');
    const deleteReassignSelect = document.getElementById('delete-category-reassign');

    function openDeleteCategoryModal(category) {
        pendingDeleteCategory = category;
        document.getElementById('delete-category-warning').textContent =
            `You are about to permanently delete "${category.name}".`;
        document.getElementById('delete-category-name-hint').textContent = category.name;
        deleteReassignSelect.innerHTML = '<option value="">— no category —</option>' +
            allCategories.filter(c => c.id !== category.id).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        deleteConfirmInput.value = '';
        deleteConfirmBtn.disabled = true;
        deleteOverlay.hidden = false;
        deleteConfirmInput.focus();
    }

    function closeDeleteCategoryModal() {
        pendingDeleteCategory = null;
        deleteOverlay.hidden = true;
    }

    deleteConfirmInput.addEventListener('input', () => {
        deleteConfirmBtn.disabled = !pendingDeleteCategory || deleteConfirmInput.value !== pendingDeleteCategory.name;
    });

    document.getElementById('delete-category-cancel-btn').addEventListener('click', closeDeleteCategoryModal);
    deleteOverlay.addEventListener('click', (e) => {
        if (e.target === deleteOverlay) closeDeleteCategoryModal();
    });

    deleteConfirmBtn.addEventListener('click', async () => {
        if (!pendingDeleteCategory || deleteConfirmInput.value !== pendingDeleteCategory.name) return;
        try {
            await window.BWApi.apiFetch(`/api/categories/${pendingDeleteCategory.id}`, {
                method: 'DELETE',
                body: { reassignTo: deleteReassignSelect.value || null }
            });
            closeDeleteCategoryModal();
            render();
        } catch (err) {
            document.getElementById('delete-category-warning').textContent = err.message || 'Could not delete this category.';
        }
    });

    render();
})();
