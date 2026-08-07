(function () {
    const container = document.getElementById('budget-groups');
    if (!container) return;
    const errorBox = document.getElementById('budget-error');

    let month = window.BWDate.todayDateInputValue().slice(0, 7); // 'YYYY-MM', local calendar day
    let groups = [];
    let allCategories = [];
    let ownerSwitcher = { forOwnerId: () => null };

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    // See public/js/payees.js's identical helper. Only covers Categories/
    // CategoryGroups here — the $ assignment endpoints (/api/budgets/...)
    // stay owner-only at every share tier (see the Phase 2 plan), so this
    // is never appended to those.
    function forQuery() {
        const id = ownerSwitcher.forOwnerId();
        return id ? `?for=${id}` : '';
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
                <button type="button" class="icon-btn" data-delete-group title="Delete group" style="border:none;background:none;cursor:pointer;">🗑</button>
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
                await window.BWApi.apiFetch(`/api/categories${forQuery()}`, { method: 'POST', body: { name: name.trim(), group: group.id } });
                render();
            } catch (err) {
                showError(err);
            }
        });
        section.querySelector('[data-delete-group]').addEventListener('click', () => deleteGroup(group));
        return section;
    }

    // No confirmation modal (unlike deleting a category/account) — the
    // server already refuses to delete a group that still has categories in
    // it (see controllers/categoryGroupsController.js), so there's no
    // cascading data loss to guard against here, just an empty group record.
    async function deleteGroup(group) {
        if (!confirm(`Delete the group "${group.name}"? It must be empty — move or delete its categories first.`)) return;
        try {
            await window.BWApi.apiFetch(`/api/category-groups/${group.id}${forQuery()}`, { method: 'DELETE' });
            render();
        } catch (err) {
            showError(err);
        }
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
    // Doubles as the "Managing: [owner]" structure-only view for regular
    // groups too (see render()) — $ assignment stays owner-only, so there's
    // nothing to show there but the category list itself either way.
    // `groupActivityCents` is this month's total across the group's
    // categories, `categoryActivityById` is the same broken out per
    // category — both null while managing another owner's structure
    // (`forId` in render()), since $ data is owner-only at every share tier
    // and there's nothing to show in that view (see render()'s own comment).
    function incomeGroupSection(group, categoriesInGroup, groupActivityCents, categoryActivityById) {
        const section = document.createElement('div');
        section.className = 'budget-group';
        const totalHtml = groupActivityCents === null ? '' :
            `<span class="money ${groupActivityCents < 0 ? 'money-negative' : 'money-positive'}" style="margin-left:auto;">${window.BWMoney.formatCents(groupActivityCents)}</span>`;
        section.innerHTML = `
            <div class="budget-group-title" style="display:flex;align-items:center;">
                ${group.name} <span class="muted" style="font-weight:normal;margin-left:4px;">(${categoriesInGroup.length})</span>
                <button type="button" class="btn btn-secondary btn-sm" data-add-category style="margin-left:8px;">+ category</button>
                <button type="button" class="icon-btn" data-delete-group title="Delete group" style="border:none;background:none;cursor:pointer;">🗑</button>
                ${totalHtml}
            </div>
            <div class="income-category-list"></div>
        `;
        const list = section.querySelector('.income-category-list');
        if (categoriesInGroup.length === 0) {
            list.innerHTML = '<div class="muted" style="padding:6px 14px;">No categories yet.</div>';
        } else {
            categoriesInGroup.forEach((c) => {
                const activityCents = categoryActivityById ? (categoryActivityById.get(c.id) || 0) : null;
                // Reuses .budget-row's own grid (Category/Assigned/Activity/
                // Available, see _budget.scss) so the amount lines up under
                // the Activity column of the regular groups above — same
                // class as categoryRow's own markup, not just the same
                // column widths, so the text comes out the same size too.
                // Assigned/Available are left blank; neither concept applies
                // to income (see envelope.js's summary()).
                const amountHtml = activityCents === null ? '' :
                    `<span class="money ${activityCents < 0 ? 'money-negative' : 'money-positive'}">${window.BWMoney.formatCents(activityCents)}</span>`;
                const row = document.createElement('div');
                row.className = 'budget-row';
                row.innerHTML = `
                    <span>${c.name}
                        <button type="button" class="icon-btn" data-delete-category title="Delete category" style="border:none;background:none;cursor:pointer;">🗑</button>
                    </span>
                    <span></span>
                    ${amountHtml || '<span></span>'}
                    <span></span>
                `;
                row.querySelector('[data-delete-category]').addEventListener('click', () => openDeleteCategoryModal(c));
                list.appendChild(row);
            });
        }
        section.querySelector('[data-add-category]').addEventListener('click', async () => {
            const name = prompt(`New income category name in "${group.name}":`);
            if (!name || !name.trim()) return;
            try {
                await window.BWApi.apiFetch(`/api/categories${forQuery()}`, { method: 'POST', body: { name: name.trim(), group: group.id } });
                render();
            } catch (err) {
                showError(err);
            }
        });
        section.querySelector('[data-delete-group]').addEventListener('click', () => deleteGroup(group));
        return section;
    }

    async function render() {
        document.getElementById('month-label').textContent = monthLabel(month);
        const forId = ownerSwitcher.forOwnerId();
        // $ assignment (month nav, Ready to Assign, "Copy budget from") is
        // owner-only at every share tier — hidden entirely while managing
        // someone else's Categories/CategoryGroups, leaving just the
        // structure-only list below (see the Phase 2 plan).
        document.querySelector('.month-nav').style.display = forId ? 'none' : '';
        document.getElementById('rta-banner').style.display = forId ? 'none' : '';
        document.getElementById('copy-budget-form').hidden = true;
        document.querySelector('.budget-row-head').style.display = forId ? 'none' : '';
        document.getElementById('budget-management-hint').hidden = !forId;
        document.getElementById('budget-drag-hint').hidden = !!forId;
        try {
            const [groupsRes, categoriesRes] = await Promise.all([
                window.BWApi.apiFetch(`/api/category-groups${forQuery()}`),
                window.BWApi.apiFetch(`/api/categories${forQuery()}`)
            ]);
            groups = groupsRes.categoryGroups;
            allCategories = categoriesRes.categories;

            let summary = null;
            if (!forId) {
                summary = await window.BWApi.apiFetch(`/api/budgets/${month}`);
                const rtaEl = document.getElementById('rta-value');
                const banner = document.getElementById('rta-banner');
                rtaEl.textContent = window.BWMoney.formatCents(summary.readyToAssignCents);
                banner.classList.toggle('rta-negative', summary.readyToAssignCents < 0);
            }

            container.innerHTML = '';
            const budgetGroups = groups.filter(g => !g.isIncome).sort((a, b) => a.sortOrder - b.sortOrder);
            if (budgetGroups.length === 0) {
                container.innerHTML = '<div class="empty-state">No category groups yet — add one above.</div>';
            } else if (forId) {
                budgetGroups.forEach(group => {
                    const cats = allCategories.filter(c => c.group === group.id);
                    container.appendChild(incomeGroupSection(group, cats, null, null));
                });
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
                let groupActivityCents = null;
                let categoryActivityById = null;
                if (!forId) {
                    const rows = summary.incomeCategories.filter(c => c.category.group === group.id);
                    groupActivityCents = rows.reduce((sum, c) => sum + c.activityCents, 0);
                    categoryActivityById = new Map(rows.map(c => [c.category.id, c.activityCents]));
                }
                incomeContainer.appendChild(incomeGroupSection(group, cats, groupActivityCents, categoryActivityById));
            });
        } catch (err) {
            showError(err);
        }
    }

    document.getElementById('prev-month-btn').addEventListener('click', () => { month = shiftMonth(month, -1); render(); });
    document.getElementById('next-month-btn').addEventListener('click', () => { month = shiftMonth(month, 1); render(); });

    // ── Copy budget from another month ────────────────────────────
    document.getElementById('toggle-copy-budget-btn').addEventListener('click', () => {
        const form = document.getElementById('copy-budget-form');
        if (!form.hidden) { form.hidden = true; return; }
        document.getElementById('copy-budget-source').value = shiftMonth(month, -1);
        form.hidden = false;
    });
    document.getElementById('copy-budget-cancel-btn').addEventListener('click', () => {
        document.getElementById('copy-budget-form').hidden = true;
    });
    document.getElementById('copy-budget-confirm-btn').addEventListener('click', async () => {
        const fromMonth = document.getElementById('copy-budget-source').value;
        if (!fromMonth) return;
        if (fromMonth === month) return showError(new Error("Source month can't be the same as the month you're viewing"));
        if (!confirm(`Copy assigned amounts from ${monthLabel(fromMonth)} into ${monthLabel(month)}? This overwrites this month's assigned amount for any category that has one in ${monthLabel(fromMonth)}.`)) return;
        try {
            await window.BWApi.apiFetch(`/api/budgets/${month}/copy`, { method: 'POST', body: { fromMonth } });
            document.getElementById('copy-budget-form').hidden = true;
            render();
        } catch (err) {
            showError(err);
        }
    });

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
            await window.BWApi.apiFetch(`/api/category-groups${forQuery()}`, {
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
            await window.BWApi.apiFetch(`/api/categories/${pendingDeleteCategory.id}${forQuery()}`, {
                method: 'DELETE',
                body: { reassignTo: deleteReassignSelect.value || null }
            });
            closeDeleteCategoryModal();
            render();
        } catch (err) {
            document.getElementById('delete-category-warning').textContent = err.message || 'Could not delete this category.';
        }
    });

    (async function init() {
        ownerSwitcher = await window.BWOwnerSwitcher.init(() => {
            document.getElementById('new-group-form').hidden = true;
            render();
        });
        render();
    })();
})();
