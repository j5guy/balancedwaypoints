const categoryGroups = require('../services/database/categoryGroups');

function serialize(group) {
    return { id: group._id, name: group.name, isIncome: group.isIncome, sortOrder: group.sortOrder };
}

async function list(req, res) {
    const items = await categoryGroups.list(req.session.userId);
    res.json({ categoryGroups: items.map(serialize) });
}

async function create(req, res) {
    const name = String((req.body || {}).name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { isIncome, sortOrder } = req.body || {};

    try {
        const group = await categoryGroups.create({ owner: req.session.userId, name, isIncome: !!isIncome, sortOrder: Number(sortOrder) || 0 });
        res.status(201).json(serialize(group));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A category group with that name already exists' });
        throw err;
    }
}

async function update(req, res) {
    const { name, isIncome, sortOrder } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (isIncome !== undefined) data.isIncome = !!isIncome;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;

    const group = await categoryGroups.update(req.params.id, data, req.session.userId);
    if (!group) return res.status(404).json({ error: 'Not found' });
    res.json(serialize(group));
}

async function remove(req, res) {
    const group = await categoryGroups.remove(req.params.id, req.session.userId);
    if (!group) return res.status(409).json({ error: 'Category group still has categories in it and cannot be deleted' });
    res.status(204).end();
}

module.exports = { list, create, update, remove };
