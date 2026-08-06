const accountShares = require('../database/accountShares');

// Resolves which owner's Categories/CategoryGroups/Payees/Tags/Rules/
// Schedules a request should operate on — the shared primitive behind both
// access patterns described in the Phase 2 plan:
//   - `account=<id>` (register context — entering a transaction on a
//     specific account, owned or shared): effective owner = that account's
//     owner, permission = whatever role the caller holds on it.
//   - `for=<ownerId>` (management context — the "Managing: [owner]"
//     switcher on the standalone Budget/Payees/Rules/Schedules pages):
//     requires an existing readwrite share with that owner on *some*
//     account (services/database/accountShares.js's hasWriteAccessToOwner),
//     since these entities aren't per-account in the data model — see the
//     plan's access-tiers table for why a readwrite share on one account
//     implies full access to the owner's whole categorization system.
//   - neither: the caller's own data, same as Phase 1.
// Both params are accepted from either the query string or the body, since
// callers use this from both GET and POST/PUT/DELETE handlers. Writes the
// appropriate error response and returns null on failure, so callers can
// just `if (!ctx) return;` — mirrors requireAccountAccess in
// controllers/transactionsController.js.
async function resolveActingOwner(req, res, { write = false } = {}) {
    const accountId = (req.query && req.query.account) || (req.body && req.body.account);
    const forOwnerId = (req.query && req.query.for) || (req.body && req.body.for);

    if (accountId) {
        const access = await accountShares.resolveAccountAccess(accountId, req.session.userId);
        if (!access) {
            res.status(404).json({ error: 'Not found' });
            return null;
        }
        if (write && access.role === 'readonly') {
            res.status(403).json({ error: 'You have read-only access to this account' });
            return null;
        }
        return { ownerId: access.ownerId, role: access.role };
    }

    if (forOwnerId) {
        const allowed = await accountShares.hasWriteAccessToOwner(req.session.userId, forOwnerId);
        if (!allowed) {
            res.status(403).json({ error: 'Not authorized' });
            return null;
        }
        return { ownerId: forOwnerId, role: 'readwrite' };
    }

    return { ownerId: req.session.userId, role: 'owner' };
}

module.exports = { resolveActingOwner };
