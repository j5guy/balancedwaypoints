const accounts = require('../services/database/accounts');
const accountShares = require('../services/database/accountShares');
const { ACCOUNT_TYPES } = require('../models/account');
const { PERMISSIONS } = require('../models/accountShare');

function serialize({ account, balanceCents, role, ownerName, ownerId, shareId }) {
    return {
        id: account._id,
        name: account.name,
        type: account.type,
        onBudget: account.onBudget,
        startingBalanceCents: account.startingBalanceCents,
        closed: account.closed,
        notes: account.notes,
        sortOrder: account.sortOrder,
        balanceCents: balanceCents != null ? balanceCents : undefined,
        // 'owner' unless this came through the shared-with-me path — lets
        // the register (public/js/register.js) know whether to show write
        // controls at all, and the Accounts page know which table to render
        // a row in.
        role: role || 'owner',
        ownerName: ownerName || undefined,
        ownerId: ownerId || undefined,
        shareId: shareId || undefined
    };
}

function serializeShare(share) {
    return {
        id: share._id,
        permission: share.permission,
        sharedWith: share.sharedWith ? { id: share.sharedWith._id, email: share.sharedWith.email, displayName: share.sharedWith.displayName } : null
    };
}

async function list(req, res) {
    const withBalances = await accounts.balancesForAll(req.session.userId);
    res.json({ accounts: withBalances.map(serialize) });
}

// Every account shared with the current user by someone else — a distinct
// list from list() above (which stays owned-accounts-only, since that's
// what Dashboard/Reports/the register's own "transfer to" dropdown expect).
async function sharedWithMe(req, res) {
    const shares = await accountShares.listSharedWithMe(req.session.userId);
    const result = await Promise.all(shares.map(async (s) => {
        const balanceCents = await accounts.balanceForAccountDoc(s.account);
        return serialize({
            account: s.account,
            balanceCents,
            role: s.permission,
            ownerName: s.owner ? (s.owner.displayName || s.owner.email) : 'Unknown',
            ownerId: s.owner ? s.owner._id : null,
            shareId: s._id
        });
    }));
    res.json({ accounts: result });
}

async function get(req, res) {
    const access = await accountShares.resolveAccountAccess(req.params.id, req.session.userId);
    if (!access) return res.status(404).json({ error: 'Not found' });
    const balanceCents = await accounts.balanceForAccountDoc(access.account);
    res.json(serialize({ account: access.account, balanceCents, role: access.role }));
}

async function create(req, res) {
    const { name, type, onBudget, startingBalanceCents, notes } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'name is required' });
    if (type && !ACCOUNT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid account type' });

    const account = await accounts.create({
        owner: req.session.userId,
        name: String(name).trim(),
        type: type || 'checking',
        onBudget: onBudget !== false,
        startingBalanceCents: Number(startingBalanceCents) || 0,
        notes: notes || ''
    });
    res.status(201).json(serialize({ account, balanceCents: account.startingBalanceCents }));
}

// Renaming/closing/deleting the account itself stays owner-only at every
// share tier (see the Phase 2 plan's access table) — these three, plus
// forceRemove below, deliberately keep the plain req.session.userId owner
// check rather than resolveAccountAccess.
async function update(req, res) {
    const { name, type, onBudget, startingBalanceCents, closed, notes, sortOrder } = req.body || {};
    if (type && !ACCOUNT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid account type' });

    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (type !== undefined) data.type = type;
    if (onBudget !== undefined) data.onBudget = !!onBudget;
    if (startingBalanceCents !== undefined) data.startingBalanceCents = Number(startingBalanceCents) || 0;
    if (closed !== undefined) data.closed = !!closed;
    if (notes !== undefined) data.notes = notes;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;

    const account = await accounts.update(req.params.id, data, req.session.userId);
    if (!account) return res.status(404).json({ error: 'Not found' });
    const balanceCents = await accounts.balanceFor(account._id, req.session.userId);
    res.json(serialize({ account, balanceCents }));
}

async function remove(req, res) {
    const account = await accounts.remove(req.params.id, req.session.userId);
    if (!account) return res.status(409).json({ error: 'Account has transactions and cannot be deleted — close it instead' });
    res.status(204).end();
}

// Deliberately separate from remove() above — this one deletes a closed
// account along with every transaction (including its half of any
// transfers) and schedule tied to it. Only reachable for accounts already
// marked closed (see services/database/accounts.js's forceRemove), so an
// active account can't be wiped by hitting the wrong endpoint.
async function forceRemove(req, res) {
    try {
        const account = await accounts.forceRemove(req.params.id, req.session.userId);
        if (!account) return res.status(404).json({ error: 'Not found' });
        res.status(204).end();
    } catch (err) {
        if (err instanceof accounts.ForceDeleteError) return res.status(400).json({ error: err.message });
        throw err;
    }
}

// ── Sharing (owner-only management of who else can see/use this account) ──
async function listShares(req, res) {
    const account = await accounts.findById(req.params.id, req.session.userId);
    if (!account) return res.status(404).json({ error: 'Not found' });
    const shares = await accountShares.listForAccount(req.params.id, req.session.userId);
    res.json({ shares: shares.map(serializeShare) });
}

async function createShare(req, res) {
    const email = String((req.body || {}).email || '').trim();
    const { permission } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (!PERMISSIONS.includes(permission)) return res.status(400).json({ error: 'permission must be "readonly" or "readwrite"' });

    const result = await accountShares.create({ accountId: req.params.id, ownerId: req.session.userId, sharedWithEmail: email, permission });
    if (result.error === 'not_found') return res.status(404).json({ error: 'Not found' });
    if (result.error === 'user_not_found') return res.status(404).json({ error: 'No user with that email — they need to sign up first' });
    if (result.error === 'self') return res.status(400).json({ error: "You can't share an account with yourself" });
    res.status(201).json(serializeShare(result.share));
}

async function updateShare(req, res) {
    const { permission } = req.body || {};
    if (!PERMISSIONS.includes(permission)) return res.status(400).json({ error: 'permission must be "readonly" or "readwrite"' });
    const share = await accountShares.update(req.params.shareId, req.params.id, req.session.userId, permission);
    if (!share) return res.status(404).json({ error: 'Not found' });
    res.json(serializeShare(share));
}

async function removeShare(req, res) {
    const share = await accountShares.remove(req.params.shareId, req.params.id, req.session.userId);
    if (!share) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
}

// Distinct owners the current user holds >=1 readwrite share with — powers
// the "Managing: [owner]" switcher on Budget/Payees/Rules/Schedules
// (routes/api/accountShares.js, a separate small router since this isn't
// scoped to one particular account the way everything above is).
async function actingOwners(req, res) {
    const owners = await accountShares.listActingOwners(req.session.userId);
    res.json({ owners: owners.map(o => ({ id: o._id, email: o.email, displayName: o.displayName })) });
}

module.exports = {
    list, sharedWithMe, get, create, update, remove, forceRemove,
    listShares, createShare, updateShare, removeShare, actingOwners
};
