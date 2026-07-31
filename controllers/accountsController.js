const accounts = require('../services/database/accounts');
const { ACCOUNT_TYPES } = require('../models/account');

function serialize({ account, balanceCents }) {
    return {
        id: account._id,
        name: account.name,
        type: account.type,
        onBudget: account.onBudget,
        startingBalanceCents: account.startingBalanceCents,
        closed: account.closed,
        notes: account.notes,
        sortOrder: account.sortOrder,
        balanceCents: balanceCents != null ? balanceCents : undefined
    };
}

async function list(req, res) {
    const withBalances = await accounts.balancesForAll();
    res.json({ accounts: withBalances.map(serialize) });
}

async function get(req, res) {
    const account = await accounts.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Not found' });
    const balanceCents = await accounts.balanceFor(account._id);
    res.json(serialize({ account, balanceCents }));
}

async function create(req, res) {
    const { name, type, onBudget, startingBalanceCents, notes } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'name is required' });
    if (type && !ACCOUNT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid account type' });

    const account = await accounts.create({
        name: String(name).trim(),
        type: type || 'checking',
        onBudget: onBudget !== false,
        startingBalanceCents: Number(startingBalanceCents) || 0,
        notes: notes || ''
    });
    res.status(201).json(serialize({ account, balanceCents: account.startingBalanceCents }));
}

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

    const account = await accounts.update(req.params.id, data);
    if (!account) return res.status(404).json({ error: 'Not found' });
    const balanceCents = await accounts.balanceFor(account._id);
    res.json(serialize({ account, balanceCents }));
}

async function remove(req, res) {
    const account = await accounts.remove(req.params.id);
    if (!account) return res.status(409).json({ error: 'Account has transactions and cannot be deleted — close it instead' });
    res.status(204).end();
}

module.exports = { list, get, create, update, remove };
