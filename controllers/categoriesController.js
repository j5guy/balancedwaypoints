const categories = require('../services/database/categories');

function serialize(category) {
    return {
        id: category._id,
        name: category.name,
        group: category.group._id || category.group,
        sortOrder: category.sortOrder,
        archived: category.archived
    };
}

async function list(req, res) {
    const includeArchived = req.query.includeArchived === 'true';
    const items = await categories.list({ includeArchived });
    res.json({ categories: items.map(serialize) });
}

async function create(req, res) {
    const name = String((req.body || {}).name || '').trim();
    const { group, sortOrder } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!group) return res.status(400).json({ error: 'group is required' });

    try {
        const category = await categories.create({ name, group, sortOrder: Number(sortOrder) || 0 });
        const populated = await categories.findById(category._id);
        res.status(201).json(serialize(populated));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A category with that name already exists in this group' });
        throw err;
    }
}

async function update(req, res) {
    const { name, group, sortOrder, archived } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (group !== undefined) data.group = group;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
    if (archived !== undefined) data.archived = !!archived;

    try {
        const category = await categories.update(req.params.id, data);
        if (!category) return res.status(404).json({ error: 'Not found' });
        const populated = await categories.findById(category._id);
        res.json(serialize(populated));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A category with that name already exists in this group' });
        throw err;
    }
}

async function remove(req, res) {
    const category = await categories.remove(req.params.id);
    if (!category) return res.status(409).json({ error: 'Category is used by existing transactions — archive it instead' });
    res.status(204).end();
}

module.exports = { list, create, update, remove };
