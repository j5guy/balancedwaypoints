const accountGroups = require('../services/database/accountGroups');

// Groups stay owner-only, same as accounts themselves (see
// accountsController.js) rather than acting-owner aware — a collaborator
// shared into someone else's account never manages that owner's grouping.
function serialize(group) {
    return { id: group._id, name: group.name, sortOrder: group.sortOrder };
}

async function list(req, res) {
    const items = await accountGroups.list(req.session.userId);
    res.json({ accountGroups: items.map(serialize) });
}

async function create(req, res) {
    const name = String((req.body || {}).name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { sortOrder } = req.body || {};

    try {
        const group = await accountGroups.create({ owner: req.session.userId, name, sortOrder: Number(sortOrder) || 0 });
        res.status(201).json(serialize(group));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'An account group with that name already exists' });
        throw err;
    }
}

async function update(req, res) {
    const { name, sortOrder } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;

    try {
        const group = await accountGroups.update(req.params.id, data, req.session.userId);
        if (!group) return res.status(404).json({ error: 'Not found' });
        res.json(serialize(group));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'An account group with that name already exists' });
        throw err;
    }
}

async function remove(req, res) {
    const group = await accountGroups.remove(req.params.id, req.session.userId);
    if (!group) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
}

module.exports = { list, create, update, remove };
