(function () {
    // Hamburger nav (views/components/nav.ejs) — the link list is a
    // collapsed dropdown on every screen size, not just mobile, toggled by
    // this one button. Closes on an outside click or Escape.
    const menuToggle = document.getElementById('nav-menu-toggle');
    const menu = document.getElementById('nav-menu');
    if (menuToggle && menu) {
        function closeMenu() {
            menu.hidden = true;
            menuToggle.setAttribute('aria-expanded', 'false');
        }
        function openMenu() {
            menu.hidden = false;
            menuToggle.setAttribute('aria-expanded', 'true');
        }
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (menu.hidden) openMenu(); else closeMenu();
        });
        document.addEventListener('click', (e) => {
            if (!menu.hidden && !menu.contains(e.target) && e.target !== menuToggle) closeMenu();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !menu.hidden) closeMenu();
        });
    }

    // "Sync All" — only shown once we know this user actually has at least
    // one SimpleFIN connection (see controllers/simplefinController.js's
    // syncAll). Most installs never touch bank sync, so this checks quietly
    // on every page load rather than the server baking it into every
    // response's locals.
    const syncAllBtn = document.getElementById('nav-sync-all-btn');
    if (syncAllBtn && window.BWApi) {
        window.BWApi.apiFetch('/api/simplefin/connections')
            .then(({ connections }) => {
                if (connections && connections.length) syncAllBtn.hidden = false;
            })
            .catch(() => { /* leave it hidden — not worth surfacing an error for */ });

        syncAllBtn.addEventListener('click', async () => {
            const original = syncAllBtn.textContent;
            syncAllBtn.disabled = true;
            syncAllBtn.textContent = '🔄 Syncing…';
            try {
                const result = await window.BWApi.apiFetch('/api/simplefin/sync-all', { method: 'POST' });
                alert(`Synced ${result.connectionsSynced} connection${result.connectionsSynced === 1 ? '' : 's'} — imported ${result.created} new transaction${result.created === 1 ? '' : 's'}.${result.warnings.length ? '\n\nWarnings:\n' + result.warnings.join('\n') : ''}`);
            } catch (err) {
                alert(err.message || 'Sync failed');
            } finally {
                syncAllBtn.disabled = false;
                syncAllBtn.textContent = original;
            }
        });
    }

    const form = document.getElementById('logout-form');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
            await window.BWApi.apiFetch('/api/auth/logout', { method: 'POST' });
        } catch (err) {
            // Log out client-side regardless — worst case the server session
            // lingers until it expires on its own (see middleware/session.js).
        }
        window.location.href = '/';
    });
})();
