(function () {
    const previewBtn = document.getElementById('preview-btn');
    if (!previewBtn) return;
    const errorBox = document.getElementById('import-error');
    let categories = [];
    let previewRows = [];

    function showError(err) {
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }

    function categoryOptionsHtml(row) {
        const options = ['<option value="">— none —</option>'].concat(
            categories.map(c => `<option value="${c.id}" ${c.id === row.suggestedCategoryId ? 'selected' : ''}>${c.name}</option>`)
        );
        // Rules/existing categories didn't match, but the CSV named one —
        // offer to create it (and its group) on commit.
        if (row.categoryName && !row.suggestedCategoryId) {
            const label = row.categoryGroupName ? `${row.categoryName} (${row.categoryGroupName})` : row.categoryName;
            options.push(`<option value="new" selected>+ Create "${label}"</option>`);
        }
        return options.join('');
    }

    function previewRow(row, index) {
        const tr = document.createElement('tr');
        const amountClass = row.amountCents < 0 ? 'money-negative' : 'money-positive';
        tr.innerHTML = `
            <td><input type="checkbox" data-include checked></td>
            <td>${window.BWDate.formatDate(row.date)}</td>
            <td>${row.suggestedPayeeName || row.payeeName || ''}</td>
            <td class="money ${amountClass}">${window.BWMoney.formatCents(row.amountCents)}</td>
            <td class="wrap">${row.notes || ''}</td>
            <td><select class="preview-category">${categoryOptionsHtml(row)}</select></td>
        `;
        tr.dataset.index = index;
        if (row.categoryName) tr.dataset.categoryName = row.categoryName;
        if (row.categoryGroupName) tr.dataset.categoryGroupName = row.categoryGroupName;
        return tr;
    }

    async function loadAccountsAndCategories() {
        const [accountsRes, categoriesRes] = await Promise.all([
            window.BWApi.apiFetch('/api/accounts'),
            window.BWApi.apiFetch('/api/categories')
        ]);
        categories = categoriesRes.categories;
        document.getElementById('import-account').innerHTML = accountsRes.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    }

    previewBtn.addEventListener('click', async () => {
        errorBox.hidden = true;
        const fileInput = document.getElementById('import-file');
        if (!fileInput.files.length) return showError(new Error('Choose a file first'));

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('accountId', document.getElementById('import-account').value);
        formData.append('format', document.getElementById('import-format').value);

        try {
            const result = await window.BWApi.apiUpload('/api/imports/preview', formData);
            previewRows = result.rows;
            document.getElementById('preview-summary').textContent =
                `${result.rows.length} new transaction(s) found` +
                (result.duplicateCount ? `, ${result.duplicateCount} duplicate(s) skipped` : '') +
                (result.errors && result.errors.length ? ` — ${result.errors.length} row issue(s)` : '');
            const tbody = document.getElementById('preview-tbody');
            tbody.innerHTML = '';
            previewRows.forEach((row, i) => tbody.appendChild(previewRow(row, i)));
            document.getElementById('preview-section').hidden = false;
        } catch (err) {
            showError(err);
        }
    });

    document.getElementById('commit-btn').addEventListener('click', async () => {
        const rows = [];
        document.querySelectorAll('#preview-tbody tr').forEach(tr => {
            if (!tr.querySelector('[data-include]').checked) return;
            const row = previewRows[Number(tr.dataset.index)];
            const categoryValue = tr.querySelector('.preview-category').value;
            const creatingCategory = categoryValue === 'new';
            rows.push({
                date: row.date,
                payeeName: row.suggestedPayeeName || row.payeeName,
                amountCents: row.amountCents,
                notes: row.notes,
                importedId: row.importedId,
                categoryId: creatingCategory ? null : (categoryValue || null),
                categoryName: creatingCategory ? tr.dataset.categoryName : undefined,
                categoryGroupName: creatingCategory ? tr.dataset.categoryGroupName : undefined,
                tagNames: row.suggestedTagNames || []
            });
        });
        if (rows.length === 0) return showError(new Error('No rows selected'));

        try {
            const result = await window.BWApi.apiFetch('/api/imports/commit', {
                method: 'POST',
                body: { accountId: document.getElementById('import-account').value, rows }
            });
            document.getElementById('preview-section').hidden = true;
            document.getElementById('preview-summary').textContent = '';
            alert(`Imported ${result.created} transaction(s).`);
            document.getElementById('import-file').value = '';
        } catch (err) {
            showError(err);
        }
    });

    loadAccountsAndCategories().catch(showError);
})();
