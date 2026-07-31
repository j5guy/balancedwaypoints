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
    // No `reassignTo` key at all in the body = the plain old behavior
    // (block outright if anything still uses it). Present (even as an
    // explicit null, meaning "move everything to no category") = the new
    // reassign-then-delete flow the UI's delete-confirmation modal drives.
    const hasReassignInstruction = req.body && Object.prototype.hasOwnProperty.call(req.body, 'reassignTo');
    if (!hasReassignInstruction) {
        const category = await categories.remove(req.params.id);
        if (!category) return res.status(409).json({ error: 'Category is used by existing transactions — reassign or archive it instead' });
        return res.status(204).end();
    }

    const reassignTo = req.body.reassignTo || null;
    if (reassignTo) {
        const target = await categories.findById(reassignTo);
        if (!target) return res.status(400).json({ error: 'Replacement category not found' });
        if (String(reassignTo) === String(req.params.id)) return res.status(400).json({ error: "Can't reassign a category to itself" });
    } else {
        const splitConflict = await categories.hasSplitReferences(req.params.id);
        if (splitConflict) {
            return res.status(400).json({ error: 'Some transactions use this category in a split — pick a replacement category (splits can\'t be set to "no category")' });
        }
    }

    const category = await categories.reassignAndRemove(req.params.id, reassignTo);
    if (!category) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
}

module.exports = { list, create, update, remove };
