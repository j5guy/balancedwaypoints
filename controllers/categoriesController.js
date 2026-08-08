const categories = require('../services/database/categories');
const categoryCleanup = require('../services/database/categoryCleanup');
const { resolveActingOwner } = require('../services/authz/actingOwner');

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
    const ctx = await resolveActingOwner(req, res);
    if (!ctx) return;
    const includeArchived = req.query.includeArchived === 'true';
    const items = await categories.list(ctx.ownerId, { includeArchived });
    res.json({ categories: items.map(serialize) });
}

async function create(req, res) {
    const ctx = await resolveActingOwner(req, res, { write: true });
    if (!ctx) return;
    const name = String((req.body || {}).name || '').trim();
    const { group, sortOrder } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!group) return res.status(400).json({ error: 'group is required' });

    try {
        const category = await categories.create({ owner: ctx.ownerId, name, group, sortOrder: Number(sortOrder) || 0 });
        const populated = await categories.findById(category._id, ctx.ownerId);
        res.status(201).json(serialize(populated));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A category with that name already exists in this group' });
        throw err;
    }
}

async function update(req, res) {
    const ctx = await resolveActingOwner(req, res, { write: true });
    if (!ctx) return;
    const { name, group, sortOrder, archived } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (group !== undefined) data.group = group;
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0;
    if (archived !== undefined) data.archived = !!archived;

    try {
        const category = await categories.update(req.params.id, data, ctx.ownerId);
        if (!category) return res.status(404).json({ error: 'Not found' });
        const populated = await categories.findById(category._id, ctx.ownerId);
        res.json(serialize(populated));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A category with that name already exists in this group' });
        throw err;
    }
}

async function remove(req, res) {
    const ctx = await resolveActingOwner(req, res, { write: true });
    if (!ctx) return;

    // No `reassignTo` key at all in the body = the plain old behavior
    // (block outright if anything still uses it). Present (even as an
    // explicit null, meaning "move everything to no category") = the new
    // reassign-then-delete flow the UI's delete-confirmation modal drives.
    const hasReassignInstruction = req.body && Object.prototype.hasOwnProperty.call(req.body, 'reassignTo');
    if (!hasReassignInstruction) {
        const category = await categories.remove(req.params.id, ctx.ownerId);
        if (!category) return res.status(409).json({ error: 'Category is used by existing transactions — reassign or archive it instead' });
        return res.status(204).end();
    }

    const reassignTo = req.body.reassignTo || null;
    if (reassignTo) {
        const target = await categories.findById(reassignTo, ctx.ownerId);
        if (!target) return res.status(400).json({ error: 'Replacement category not found' });
        if (String(reassignTo) === String(req.params.id)) return res.status(400).json({ error: "Can't reassign a category to itself" });
    } else {
        const splitConflict = await categories.hasSplitReferences(req.params.id, ctx.ownerId);
        if (splitConflict) {
            return res.status(400).json({ error: 'Some transactions use this category in a split — pick a replacement category (splits can\'t be set to "no category")' });
        }
    }

    const category = await categories.reassignAndRemove(req.params.id, reassignTo, ctx.ownerId);
    if (!category) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
}

// ── Cleanup tool (views/budget/categoriesCleanup.ejs) — duplicate-merge
// and unused-delete, both scrubbing every reference outside Transactions
// too (Payee defaults, Rule setCategory actions, dashboard widget category
// selections), not just the ones the single-category delete/reassign flow
// above already covers.
async function cleanupReport(req, res) {
    const ctx = await resolveActingOwner(req, res);
    if (!ctx) return;
    const [duplicateGroups, unused] = await Promise.all([
        categoryCleanup.findDuplicates(ctx.ownerId),
        categoryCleanup.findUnused(ctx.ownerId)
    ]);
    res.json({ duplicateGroups, unused });
}

async function merge(req, res) {
    const ctx = await resolveActingOwner(req, res, { write: true });
    if (!ctx) return;
    const { fromIds, toId } = req.body || {};
    if (!Array.isArray(fromIds) || fromIds.length === 0) return res.status(400).json({ error: 'fromIds is required' });
    if (typeof toId !== 'string' || !toId) return res.status(400).json({ error: 'toId is required' });
    if (fromIds.some(id => String(id) === String(toId))) return res.status(400).json({ error: "Can't merge a category into itself" });

    const target = await categories.findById(toId, ctx.ownerId);
    if (!target) return res.status(400).json({ error: 'Target category not found' });
    for (const id of fromIds) {
        const source = await categories.findById(id, ctx.ownerId);
        if (!source) return res.status(400).json({ error: 'One of the selected categories was not found' });
    }

    await categoryCleanup.mergeCategories(fromIds, toId, ctx.ownerId);
    res.status(204).end();
}

async function bulkDelete(req, res) {
    const ctx = await resolveActingOwner(req, res, { write: true });
    if (!ctx) return;
    const { categoryIds } = req.body || {};
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) return res.status(400).json({ error: 'categoryIds is required' });

    const result = await categoryCleanup.deleteUnused(categoryIds, ctx.ownerId);
    res.json(result);
}

module.exports = { list, create, update, remove, cleanupReport, merge, bulkDelete };
