(function () {
    const errorBox = document.getElementById('cleanup-error');
    const duplicatesList = document.getElementById('duplicates-list');
    const unusedList = document.getElementById('unused-list');
    const unusedDeleteBtn = document.getElementById('unused-delete-btn');

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }
    function clearError() { errorBox.hidden = true; }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    let selectedUnusedIds = new Set();

    function duplicateGroupHtml(group, index) {
        const rows = group.map((c, i) => `
            <div class="checkbox-row form-group">
                <input type="radio" name="dup-target-${index}" id="dup-${index}-${c.id}" value="${c.id}" ${i === 0 ? 'checked' : ''}>
                <label for="dup-${index}-${c.id}">
                    ${escapeHtml(c.name)} — ${c.group ? escapeHtml(c.group.name) : 'No group'}${c.archived ? ' (archived)' : ''}
                    — used ${c.usageCount} time${c.usageCount === 1 ? '' : 's'}
                </label>
            </div>
        `).join('');
        return `
            <div class="card" style="margin-bottom:12px;">
                <p style="margin-top:0;"><strong>${escapeHtml(group[0].name)}</strong> — ${group.length} categories with this name. Pick which one to keep:</p>
                ${rows}
                <div class="btn-row">
                    <button type="button" class="btn btn-primary btn-sm" data-merge-group="${index}">Merge into selected</button>
                </div>
            </div>
        `;
    }

    let duplicateGroups = [];

    function renderDuplicates() {
        if (duplicateGroups.length === 0) {
            duplicatesList.innerHTML = '<p class="muted" style="font-size:0.85rem;">No duplicate categories found.</p>';
            return;
        }
        duplicatesList.innerHTML = duplicateGroups.map((group, i) => duplicateGroupHtml(group, i)).join('');
        duplicatesList.querySelectorAll('[data-merge-group]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const index = Number(btn.dataset.mergeGroup);
                const group = duplicateGroups[index];
                const checked = duplicatesList.querySelector(`input[name="dup-target-${index}"]:checked`);
                if (!checked) return;
                const toId = checked.value;
                const fromIds = group.map(c => c.id).filter(id => id !== toId);
                clearError();
                btn.disabled = true;
                try {
                    await window.BWApi.apiFetch('/api/categories/merge', { method: 'POST', body: { fromIds, toId } });
                    await loadReport();
                } catch (err) {
                    showError(err);
                    btn.disabled = false;
                }
            });
        });
    }

    let unusedCategories = [];

    function renderUnused() {
        if (unusedCategories.length === 0) {
            unusedList.innerHTML = '<p class="muted" style="font-size:0.85rem;">No unused categories found.</p>';
            unusedDeleteBtn.disabled = true;
            return;
        }
        unusedList.innerHTML = unusedCategories.map(c => `
            <div class="checkbox-row form-group">
                <input type="checkbox" id="unused-${c.id}" data-category-id="${c.id}" ${selectedUnusedIds.has(c.id) ? 'checked' : ''}>
                <label for="unused-${c.id}">${escapeHtml(c.name)} — ${c.group ? escapeHtml(c.group.name) : 'No group'}${c.archived ? ' (archived)' : ''}</label>
            </div>
        `).join('');
        unusedList.querySelectorAll('[data-category-id]').forEach((cb) => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.categoryId;
                if (cb.checked) selectedUnusedIds.add(id); else selectedUnusedIds.delete(id);
                unusedDeleteBtn.disabled = selectedUnusedIds.size === 0;
            });
        });
        unusedDeleteBtn.disabled = selectedUnusedIds.size === 0;
    }

    document.getElementById('unused-select-all-btn').addEventListener('click', () => {
        selectedUnusedIds = new Set(unusedCategories.map(c => c.id));
        renderUnused();
    });
    document.getElementById('unused-deselect-all-btn').addEventListener('click', () => {
        selectedUnusedIds = new Set();
        renderUnused();
    });

    // ── Bulk-delete confirmation ───────────────────────────────────────
    const confirmOverlay = document.getElementById('confirm-delete-overlay');
    const confirmCount = document.getElementById('confirm-delete-count');
    const confirmList = document.getElementById('confirm-delete-list');
    const confirmBtn = document.getElementById('confirm-delete-btn');

    unusedDeleteBtn.addEventListener('click', () => {
        const toDelete = unusedCategories.filter(c => selectedUnusedIds.has(c.id));
        if (toDelete.length === 0) return;
        confirmCount.textContent = toDelete.length;
        confirmList.innerHTML = toDelete.map(c => `<li>${escapeHtml(c.name)}${c.group ? ' — ' + escapeHtml(c.group.name) : ''}</li>`).join('');
        confirmOverlay.hidden = false;
    });
    document.getElementById('cancel-delete-btn').addEventListener('click', () => { confirmOverlay.hidden = true; });
    confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) confirmOverlay.hidden = true; });

    confirmBtn.addEventListener('click', async () => {
        const categoryIds = [...selectedUnusedIds];
        clearError();
        confirmBtn.disabled = true;
        try {
            const result = await window.BWApi.apiFetch('/api/categories/bulk-delete', { method: 'POST', body: { categoryIds } });
            confirmOverlay.hidden = true;
            selectedUnusedIds = new Set();
            if (result.skipped && result.skipped.length) {
                showError(new Error(`${result.deleted.length} deleted. ${result.skipped.length} were skipped — they turned out to still be in use.`));
            }
            await loadReport();
        } catch (err) {
            showError(err);
        } finally {
            confirmBtn.disabled = false;
        }
    });

    async function loadReport() {
        try {
            const report = await window.BWApi.apiFetch('/api/categories/cleanup-report');
            duplicateGroups = report.duplicateGroups || [];
            unusedCategories = report.unused || [];
            selectedUnusedIds = new Set([...selectedUnusedIds].filter(id => unusedCategories.some(c => c.id === id)));
            renderDuplicates();
            renderUnused();
        } catch (err) {
            showError(err);
        }
    }

    loadReport();
})();
