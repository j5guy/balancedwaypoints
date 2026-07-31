const transactions = require('../services/database/transactions');
const rulesDb = require('../services/database/rules');
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
        schedule: t.schedule || null
    };
}

function validateSplits(amountCents, splits) {
    if (!splits || splits.length === 0) return null;
    const sum = splits.reduce((s, split) => s + Number(split.amountCents), 0);
    if (sum !== Number(amountCents)) return 'Split amounts must add up to the transaction total';
    return null;
}

async function list(req, res) {
    const { account, category, tag, payee, from, to, limit } = req.query;
    const items = await transactions.list({ account, category, tag, payee, from, to, limit: limit ? Number(limit) : undefined });
    res.json({ transactions: items.map(serialize) });
}

async function get(req, res) {
    const t = await transactions.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(serialize(t));
}

async function create(req, res) {
    const { account, date, payee, amountCents, category, splits, cleared, tags, notes } = req.body || {};
    if (!account) return res.status(400).json({ error: 'account is required' });
    if (!date) return res.status(400).json({ error: 'date is required' });
    if (amountCents === undefined || amountCents === null) return res.status(400).json({ error: 'amountCents is required' });

    const splitError = validateSplits(amountCents, splits);
    if (splitError) return res.status(400).json({ error: splitError });

    const t = await transactions.create({
        account, date, payee: payee || null,
        amountCents: Number(amountCents),
        category: splits && splits.length ? null : (category || null),
        splits: splits || [],
        cleared: cleared || 'pending',
        tags: tags || [],
        notes: notes || ''
    });
    const populated = await transactions.findById(t._id);
    res.status(201).json(serialize(populated));
}

async function createTransfer(req, res) {
    const { fromAccount, toAccount, date, amountCents, notes } = req.body || {};
    if (!fromAccount || !toAccount) return res.status(400).json({ error: 'fromAccount and toAccount are required' });
    if (fromAccount === toAccount) return res.status(400).json({ error: 'fromAccount and toAccount must differ' });
    if (!date) return res.status(400).json({ error: 'date is required' });
    if (!amountCents) return res.status(400).json({ error: 'amountCents is required' });

    const { outgoing, incoming } = await transactions.createTransfer({ fromAccount, toAccount, date, amountCents: Number(amountCents), notes });
    res.status(201).json({ outgoing: serialize(outgoing), incoming: serialize(incoming) });
}

async function update(req, res) {
    const existing = await transactions.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.transferId) return res.status(400).json({ error: 'Transfer transactions cannot be edited directly — delete and recreate the transfer instead' });

    const { account, date, payee, amountCents, category, splits, cleared, tags, notes } = req.body || {};
    const effectiveAmount = amountCents !== undefined ? amountCents : existing.amountCents;
    const effectiveSplits = splits !== undefined ? splits : existing.splits;
    const splitError = validateSplits(effectiveAmount, effectiveSplits);
    if (splitError) return res.status(400).json({ error: splitError });

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

    const t = await transactions.update(req.params.id, data);
    res.json(serialize(t));
}

async function remove(req, res) {
    const existing = await transactions.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    if (existing.transferId) {
        await transactions.removeTransferPair(existing.transferId);
    } else {
        await transactions.remove(req.params.id);
    }
    res.status(204).end();
}

// Runs the active ruleset against a candidate (not-yet-saved) transaction
// and returns suggested category/payee/tags — never writes anything.
async function previewRules(req, res) {
    const { payee, notes, amountCents } = req.body || {};
    const rules = await rulesDb.findActive();
    const result = await applyRules(rules, { payee, notes, amountCents: Number(amountCents) || 0 });
    res.json(result);
}

module.exports = { list, get, create, createTransfer, update, remove, previewRules };
