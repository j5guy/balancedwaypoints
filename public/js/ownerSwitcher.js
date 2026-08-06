// Reusable "Managing: [owner]" control for Budget/Payees/Rules/Schedules —
// only shown if the current user holds >=1 readwrite account share (see
// services/database/accountShares.js's listActingOwners, exposed via
// GET /api/account-shares/acting-owners). `onChange(forOwnerId)` fires with
// null for "my data" or the chosen owner's id; the calling page re-runs its
// own load with that id appended as ?for=<id> to every fetch (see
// services/authz/actingOwner.js's resolveActingOwner).
(function () {
    window.BWOwnerSwitcher = {
        async init(onChange) {
            const wrap = document.getElementById('owner-switcher-wrap');
            const select = document.getElementById('owner-switcher-select');
            const noop = { forOwnerId: () => null };
            if (!wrap || !select) return noop;

            let forOwnerId = null;
            try {
                const { owners } = await window.BWApi.apiFetch('/api/account-shares/acting-owners');
                if (owners.length === 0) return noop;

                select.innerHTML = '<option value="">My data</option>' +
                    owners.map(o => `<option value="${o.id}">${o.displayName || o.email}</option>`).join('');
                wrap.hidden = false;
                select.addEventListener('change', () => {
                    forOwnerId = select.value || null;
                    onChange(forOwnerId);
                });
            } catch (err) {
                // Degrades to "my data only" — a failed switcher shouldn't
                // block the page's own primary load.
            }
            return { forOwnerId: () => forOwnerId };
        }
    };
})();
