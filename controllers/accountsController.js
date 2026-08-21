const accounts = require('../services/database/accounts');
const accountShares = require('../services/database/accountShares');
const accountGroups = require('../services/database/accountGroups');
const { ACCOUNT_TYPES } = require('../models/account');
const { PERMISSIONS } = require('../models/accountShare');

// null clears the group (a fully-supported "ungrouped" state); any other
// value must resolve to a group this owner actually has, same ownership
// check every other owner-scoped lookup in this file already does.
async function resolveGroupId(group, ownerId) {
    if (group === undefined) return undefined;
    if (group === null || group === '') return null;
    const found = await accountGroups.findById(group, ownerId);
    if (!found) throw new Error('Invalid account group');
    return found._id;
}

// Same shape as resolveGroupId above — null clears the pairing, any other
// value must resolve to another account this owner actually has.
// `excludeId` (only set on update, never create) blocks pointing an account
// at itself.
async function resolveLinkedAccountId(linkedAccount, ownerId, excludeId) {
    if (linkedAccount === undefined) return undefined;
    if (linkedAccount === null || linkedAccount === '') return null;
    if (excludeId && String(linkedAccount) === String(excludeId)) throw new Error("An account can't be linked to itself");
    const found = await accounts.findById(linkedAccount, ownerId);
    if (!found) throw new Error('Invalid linked account');
    return found._id;
}

function serialize({ account, balanceCents, role, ownerName, ownerId, shareId }) {
    return {
        id: account._id,
        name: account.name,
        type: account.type,
        onBudget: account.onBudget,
        startingBalanceCents: account.startingBalanceCents,
        forecastThresholdCents: account.forecastThresholdCents != null ? account.forecastThresholdCents : null,
        forecastThresholdColor: account.forecastThresholdColor || '#B5433A',
        closed: account.closed,
        notes: account.notes,
        sortOrder: account.sortOrder,
        group: account.group || undefined,
        linkedAccount: account.linkedAccount || undefined,
        address: account.address || '',
        city: account.city || '',
        state: account.state || '',
        zip: account.zip || '',
        vehicleYear: account.vehicleYear || '',
        vehicleMake: account.vehicleMake || '',
        vehicleModel: account.vehicleModel || '',
        vehicleTrim: account.vehicleTrim || '',
        vehicleVin: account.vehicleVin || '',
        balanceCents: balanceCents != null ? balanceCents : undefined,
        // 'owner' unless this came through the shared-with-me path — lets
        // the register (public/js/register.js) know whether to show write
        // controls at all, and the Accounts page know which table to render
        // a row in.
        role: role || 'owner',
        ownerName: ownerName || undefined,
        ownerId: ownerId || undefined,
        shareId: shareId || undefined,
        // Bank sync (see services/simplefin/) — both null for a normal
        // manually-managed account. simplefinBalanceCents is the
        // bank-reported balance as of the last sync, purely for the
        // register's own reconciliation display; it never affects
        // balanceCents above, which is always computed from transactions.
        simplefinConnection: account.simplefinConnection || undefined,
        simplefinAccountId: account.simplefinAccountId || undefined,
        simplefinBalanceCents: account.simplefinBalanceCents != null ? account.simplefinBalanceCents : undefined,
        simplefinBalanceDate: account.simplefinBalanceDate || undefined
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
    const {
        name, type, onBudget, startingBalanceCents, forecastThresholdCents, forecastThresholdColor, notes, group, linkedAccount,
        address, city, state, zip, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, vehicleVin
    } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'name is required' });
    if (type && !ACCOUNT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid account type' });

    let groupId, linkedAccountId;
    try {
        groupId = await resolveGroupId(group, req.session.userId);
        linkedAccountId = await resolveLinkedAccountId(linkedAccount, req.session.userId);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const account = await accounts.create({
        owner: req.session.userId,
        name: String(name).trim(),
        type: type || 'checking',
        onBudget: onBudget !== false,
        startingBalanceCents: Number(startingBalanceCents) || 0,
        forecastThresholdCents: forecastThresholdCents != null && forecastThresholdCents !== '' ? Number(forecastThresholdCents) : null,
        forecastThresholdColor: forecastThresholdColor || '#B5433A',
        notes: notes || '',
        group: groupId || null,
        linkedAccount: linkedAccountId || null,
        address: address || '',
        city: city || '',
        state: state || '',
        zip: zip || '',
        vehicleYear: vehicleYear || '',
        vehicleMake: vehicleMake || '',
        vehicleModel: vehicleModel || '',
        vehicleTrim: vehicleTrim || '',
        vehicleVin: vehicleVin || ''
    });
    res.status(201).json(serialize({ account, balanceCents: account.startingBalanceCents }));
}

// Renaming/closing/deleting the account itself stays owner-only at every
// share tier (see the Phase 2 plan's access table) — these three, plus
// forceRemove below, deliberately keep the plain req.session.userId owner
// check rather than resolveAccountAccess.
async function update(req, res) {
    const {
        name, type, onBudget, startingBalanceCents, forecastThresholdCents, forecastThresholdColor, closed, notes, sortOrder, group, linkedAccount,
        address, city, state, zip, vehicleYear, vehicleMake, vehicleModel, vehicleTrim, vehicleVin
    } = req.body || {};
    if (type && !ACCOUNT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid account type' });

    let groupId, linkedAccountId;
    try {
        groupId = await resolveGroupId(group, req.session.userId);
        linkedAccountId = await resolveLinkedAccountId(linkedAccount, req.session.userId, req.params.id);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (type !== undefined) data.type = type;
    if (onBudget !== undefined) data.onBudget = !!onBudget;
    if (startingBalanceCents !== undefined) data.startingBalanceCents = Number(startingBalanceCents) || 0;
    if (forecastThresholdCents !== undefined) data.forecastThresholdCents = forecastThresholdCents != null && forecastThresholdCents !== '' ? Number(forecastThresholdCents) : null;
    if (forecastThresholdColor !== undefined) data.forecastThresholdColor = forecastThresholdColor || '#B5433A';
    if (closed !== undefined) data.closed = !!closed;
    if (notes !== undefined) data.notes = notes;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
    if (groupId !== undefined) data.group = groupId;
    if (linkedAccountId !== undefined) data.linkedAccount = linkedAccountId;
    if (address !== undefined) data.address = address;
    if (city !== undefined) data.city = city;
    if (state !== undefined) data.state = state;
    if (zip !== undefined) data.zip = zip;
    if (vehicleYear !== undefined) data.vehicleYear = vehicleYear;
    if (vehicleMake !== undefined) data.vehicleMake = vehicleMake;
    if (vehicleModel !== undefined) data.vehicleModel = vehicleModel;
    if (vehicleTrim !== undefined) data.vehicleTrim = vehicleTrim;
    if (vehicleVin !== undefined) data.vehicleVin = vehicleVin;

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

// Detaches this account from whatever SimpleFIN connection it's linked to —
// its transaction history stays put, it just stops receiving new synced
// rows and goes back to being a plain manual account. Doesn't touch the
// connection itself or any other account linked to it.
async function unlinkSimplefin(req, res) {
    const account = await accounts.update(req.params.id, {
        simplefinConnection: null,
        simplefinAccountId: null,
        simplefinBalanceCents: null,
        simplefinBalanceDate: null
    }, req.session.userId);
    if (!account) return res.status(404).json({ error: 'Not found' });
    const balanceCents = await accounts.balanceForAccountDoc(account);
    res.json(serialize({ account, balanceCents }));
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
    list, sharedWithMe, get, create, update, remove, forceRemove, unlinkSimplefin,
    listShares, createShare, updateShare, removeShare, actingOwners
};
