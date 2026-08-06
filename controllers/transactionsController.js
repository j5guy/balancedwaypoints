const transactions = require('../services/database/transactions');
const rulesDb = require('../services/database/rules');
const accountShares = require('../services/database/accountShares');
const { applyRules } = require('../services/rules/applyRules');

function serialize(t) {
    return {
        id: t._id,
        account: t.account,
        date: t.date,
        payee: t.payee ? { id: t.payee._id, name: t.payee.name } : null,
        amountCents: t.amountCents,
        category: t.category ? { id: t.category._id, name: t.category.name } : null,
        splits: (t.splits || []).map(s => ({
            category: s.category && s.category._id ? { id: s.category._id, name: s.category.name } : s.category,
            amountCents: s.amountCents,
            notes: s.notes
        })),
        cleared: t.cleared,
        tags: (t.tags || []).map(tag => tag._id ? { id: tag._id, name: tag.name } : tag),
        notes: t.notes,
        transferAccount: t.transferAccount || null,
        transferId: t.transferId || null,
        importedId: t.importedId || null,
        schedule: t.schedule || null,
        sortOrder: t.sortOrder,
        createdAt: t.createdAt
    };
}

function validateSplits(amountCents, splits) {
    if (!splits || splits.length === 0) return null;
    const sum = splits.reduce((s, split) => s + Number(split.amountCents), 0);
    if (sum !== Number(amountCents)) return 'Split amounts must add up to the transaction total';
    return null;
}

// Every handler below resolves access via the account in play (not a flat
// req.session.userId match, per Phase 1) — see services/database/accountShares.js's
// resolveAccountAccess. `write` callers additionally require role !== 'readonly'.
// Returns the resolved access object, or writes the error response itself
// and returns null (so callers can just `if (!access) return;`).
async function requireAccountAccess(req, res, accountId, { write = false } = {}) {
    if (!accountId) {
        res.status(400).json({ error: 'account is required' });
        return null;
    }
    const access = await accountShares.resolveAccountAccess(accountId, req.session.userId);
    if (!access) {
        res.status(404).json({ error: 'Not found' });
        return null;
    }
    if (write && access.role === 'readonly') {
        res.status(403).json({ error: 'You have read-only access to this account' });
        return null;
    }
    return access;
}

async function list(req, res) {
    const { account, category, tag, payee, from, to, limit, sort } = req.query;
    // No account filter = "everything I own" (existing Phase 1 behavior) —
    // shared access is inherently per-account, so there's no equivalent
    // "everything shared with me" cross-account query.
    const ownerId = account
        ? (await requireAccountAccess(req, res, account))?.ownerId
        : req.session.userId;
    if (account && !ownerId) return;

    const items = await transactions.list(ownerId, { account, category, tag, payee, from, to, limit: limit ? Number(limit) : undefined, sort });
    res.json({ transactions: items.map(serialize) });
}

async function get(req, res) {
    const t = await transactions.findByIdRaw(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const access = await requireAccountAccess(req, res, t.account);
    if (!access) return;
    res.json(serialize(t));
}

async function create(req, res) {
    const { account, date, payee, amountCents, category, splits, cleared, tags, notes } = req.body || {};
    const access = await requireAccountAccess(req, res, account, { write: true });
    if (!access) return;
    if (!date) return res.status(400).json({ error: 'date is required' });
    if (amountCents === undefined || amountCents === null) return res.status(400).json({ error: 'amountCents is required' });

    const splitError = validateSplits(amountCents, splits);
    if (splitError) return res.status(400).json({ error: splitError });

    const t = await transactions.create({
        owner: access.ownerId,
        account, date, payee: payee || null,
        amountCents: Number(amountCents),
        category: splits && splits.length ? null : (category || null),
        splits: splits || [],
        cleared: cleared || 'pending',
        tags: tags || [],
        notes: notes || ''
    });
    const populated = await transactions.findById(t._id, access.ownerId);
    res.status(201).json(serialize(populated));
}

async function createTransfer(req, res) {
    const { fromAccount, toAccount, date, amountCents, notes } = req.body || {};
    if (!fromAccount || !toAccount) return res.status(400).json({ error: 'fromAccount and toAccount are required' });
    if (fromAccount === toAccount) return res.status(400).json({ error: 'fromAccount and toAccount must differ' });
    if (!date) return res.status(400).json({ error: 'date is required' });
    if (!amountCents) return res.status(400).json({ error: 'amountCents is required' });

    const fromAccess = await requireAccountAccess(req, res, fromAccount, { write: true });
    if (!fromAccess) return;
    const toAccess = await requireAccountAccess(req, res, toAccount, { write: true });
    if (!toAccess) return;
    // No cross-owner transfers in v1 — see the Phase 2 plan. Both accounts
    // must belong to the same owner (yourself, or someone you have
    // readwrite access to), even if you reached them via different shares.
    if (String(fromAccess.ownerId) !== String(toAccess.ownerId)) {
        return res.status(400).json({ error: "Can't transfer between accounts with different owners" });
    }

    const { outgoing, incoming } = await transactions.createTransfer({ owner: fromAccess.ownerId, fromAccount, toAccount, date, amountCents: Number(amountCents), notes });
    res.status(201).json({ outgoing: serialize(outgoing), incoming: serialize(incoming) });
}

// Replaces a plain transaction with a transfer pair carrying the same date/
// amount/notes — the register's "Convert to transfer" action, for when an
// entry turns out to have been a transfer all along (see update()'s
// transferId guard: there's no way to turn an existing single-sided entry
// into one in place, only delete-and-recreate, which this does for you in
// one step). Not wrapped in a DB transaction (this app has no replica set to
// support one) — same sequential-writes tradeoff already accepted elsewhere
// in this codebase (e.g. categories.js's reassignAndRemove).
async function convertToTransfer(req, res) {
    const existing = await transactions.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const access = await requireAccountAccess(req, res, existing.account, { write: true });
    if (!access) return;
    if (existing.transferId) return res.status(400).json({ error: 'This is already a transfer' });
    if (existing.splits && existing.splits.length) {
        return res.status(400).json({ error: "Split transactions can't be converted to a transfer — remove the splits first" });
    }

    const { toAccount } = req.body || {};
    if (!toAccount) return res.status(400).json({ error: 'toAccount is required' });
    if (String(toAccount) === String(existing.account)) {
        return res.status(400).json({ error: "toAccount must be different from this transaction's own account" });
    }
    const toAccess = await requireAccountAccess(req, res, toAccount, { write: true });
    if (!toAccess) return;
    if (String(toAccess.ownerId) !== String(access.ownerId)) {
        return res.status(400).json({ error: "Can't transfer between accounts with different owners" });
    }

    // The existing entry's own sign decides direction — a negative amount
    // means money already left THIS account (so it's the "from" side), a
    // positive one means it arrived here (so the picked account is actually
    // the "from" side) — same as createTransfer's own -Math.abs/+Math.abs
    // convention, just inferred instead of asked for, since the amount here
    // is already fixed by the entry being converted.
    const isOutgoing = existing.amountCents < 0;
    const fromAccount = isOutgoing ? existing.account : toAccount;
    const realToAccount = isOutgoing ? toAccount : existing.account;

    await transactions.remove(req.params.id, access.ownerId);
    const { outgoing, incoming } = await transactions.createTransfer({
        owner: access.ownerId,
        fromAccount,
        toAccount: realToAccount,
        date: existing.date,
        amountCents: Math.abs(existing.amountCents),
        notes: existing.notes
    });
    res.status(201).json({ outgoing: serialize(outgoing), incoming: serialize(incoming) });
}

async function update(req, res) {
    const existing = await transactions.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const access = await requireAccountAccess(req, res, existing.account, { write: true });
    if (!access) return;
    if (existing.transferId) return res.status(400).json({ error: 'Transfer transactions cannot be edited directly — delete and recreate the transfer instead' });

    const { account, date, payee, amountCents, category, splits, cleared, tags, notes } = req.body || {};
    const effectiveAmount = amountCents !== undefined ? amountCents : existing.amountCents;
    const effectiveSplits = splits !== undefined ? splits : existing.splits;
    const splitError = validateSplits(effectiveAmount, effectiveSplits);
    if (splitError) return res.status(400).json({ error: splitError });

    // Moving a transaction to a different account requires write access to
    // THAT account too — and, same reasoning as createTransfer's no-cross-
    // owner-transfers rule, the target must belong to the SAME owner as the
    // source. The transaction's own `owner` field doesn't change here (still
    // access.ownerId below), so a cross-owner move would otherwise leave it
    // pointing at one owner's account while stamped with a different
    // owner — invisible to that owner's own reports, which match Transaction
    // by `owner` directly rather than joining through Account.
    if (account !== undefined && String(account) !== String(existing.account)) {
        const targetAccess = await requireAccountAccess(req, res, account, { write: true });
        if (!targetAccess) return;
        if (String(targetAccess.ownerId) !== String(access.ownerId)) {
            return res.status(400).json({ error: "Can't move a transaction to an account with a different owner" });
        }
    }

    const data = {};
    if (account !== undefined) data.account = account;
    if (date !== undefined) data.date = date;
    if (payee !== undefined) data.payee = payee || null;
    if (amountCents !== undefined) data.amountCents = Number(amountCents);
    if (splits !== undefined) { data.splits = splits; data.category = splits.length ? null : (category || null); }
    else if (category !== undefined) data.category = category || null;
    if (cleared !== undefined) data.cleared = cleared;
    if (tags !== undefined) data.tags = tags;
    if (notes !== undefined) data.notes = notes;

    const t = await transactions.update(req.params.id, data, access.ownerId);
    res.json(serialize(t));
}

async function remove(req, res) {
    const existing = await transactions.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const access = await requireAccountAccess(req, res, existing.account, { write: true });
    if (!access) return;

    if (existing.transferId) {
        await transactions.removeTransferPair(existing.transferId, access.ownerId);
    } else {
        await transactions.remove(req.params.id, access.ownerId);
    }
    res.status(204).end();
}

// Persists a new manual display order for the register (drag-and-drop) —
// a dedicated action, separate from update(), because it needs to work even
// for transfer-linked or schedule-created rows that update() otherwise
// locks down; sortOrder is purely cosmetic and never affects balances.
// `account` identifies which register this reorder came from (all ids are
// expected to belong to it) so access only needs resolving once.
async function reorder(req, res) {
    const { ids, account } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids must be a non-empty array' });
    const access = await requireAccountAccess(req, res, account, { write: true });
    if (!access) return;
    await transactions.reorder(ids, access.ownerId);
    res.status(204).end();
}

// Runs the active ruleset against a candidate (not-yet-saved) transaction
// and returns suggested category/payee/tags — never writes anything.
// `account` is optional — omitted means "my own rules" (e.g. previewing
// outside any specific register), same as Phase 1.
async function previewRules(req, res) {
    const { payee, notes, amountCents, account } = req.body || {};
    const ownerId = account
        ? (await requireAccountAccess(req, res, account))?.ownerId
        : req.session.userId;
    if (account && !ownerId) return;

    const rules = await rulesDb.findActive(ownerId);
    const result = await applyRules(rules, { payee, notes, amountCents: Number(amountCents) || 0 });
    res.json(result);
}

module.exports = { list, get, create, createTransfer, convertToTransfer, update, remove, reorder, previewRules };
