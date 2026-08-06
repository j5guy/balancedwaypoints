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

    async function loadAccounts() {
        const { accounts } = await window.BWApi.apiFetch('/api/accounts');
        const select = document.getElementById('import-account');
        select.innerHTML = accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
        return accounts;
    }

    async function loadAccountsAndCategories() {
        const [accounts] = await Promise.all([
            loadAccounts(),
            refreshCategories()
        ]);

        // Deep-linked from an account register's "Import" button (see
        // accounts/show.ejs) — preselects that account instead of leaving
        // whichever one happened to sort first.
        const params = new URLSearchParams(window.location.search);
        const preselect = params.get('account');
        if (preselect && accounts.some(a => a.id === preselect)) {
            document.getElementById('import-account').value = preselect;
        }
    }

    // Re-fetched fresh right before every preview (not just once on page
    // load) — otherwise a category created earlier in the same session (via
    // this page's own "+ Create" option on a prior import, or elsewhere)
    // would still be missing from `categories` here. previewRow's dropdown
    // only marks a <select> as pointing at an existing category when that
    // id is actually present in `categories`; if it's stale/missing, the
    // suggestion silently falls back to "— none —" AND skips the
    // "+ Create" fallback too (since the server-side suggestion already had
    // a matching id) — the category gets dropped from the import entirely
    // with no error. includeArchived matches what the server's own preview()
    // suggestion-matching considers (see controllers/importController.js),
    // so an archived category can't cause the same silent drop either.
    async function refreshCategories() {
        const { categories: fresh } = await window.BWApi.apiFetch('/api/categories?includeArchived=true');
        categories = fresh;
        return categories;
    }

    // ── Create a new account without leaving the import page ─────────
    // Minimal fields only (name + type) — starting balance defaults to 0
    // and onBudget to true, same defaults the full Accounts page's form
    // uses (see public/js/accounts.js's resetForm); anything more specific
    // can still be edited from the Accounts page afterward.
    document.getElementById('new-account-toggle-btn').addEventListener('click', () => {
        const form = document.getElementById('new-account-form');
        form.hidden = !form.hidden;
        if (!form.hidden) document.getElementById('new-account-name').focus();
    });
    document.getElementById('new-account-cancel-btn').addEventListener('click', () => {
        document.getElementById('new-account-form').hidden = true;
        document.getElementById('new-account-name').value = '';
    });
    document.getElementById('new-account-save-btn').addEventListener('click', async () => {
        const name = document.getElementById('new-account-name').value.trim();
        if (!name) return showError(new Error('Account name is required'));
        try {
            const created = await window.BWApi.apiFetch('/api/accounts', {
                method: 'POST',
                body: { name, type: document.getElementById('new-account-type').value, startingBalanceCents: 0, onBudget: true }
            });
            await loadAccounts();
            document.getElementById('import-account').value = created.id;
            document.getElementById('new-account-form').hidden = true;
            document.getElementById('new-account-name').value = '';
        } catch (err) {
            showError(err);
        }
    });

    previewBtn.addEventListener('click', async () => {
        errorBox.hidden = true;
        const fileInput = document.getElementById('import-file');
        if (!fileInput.files.length) return showError(new Error('Choose a file first'));

        await refreshCategories();
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
