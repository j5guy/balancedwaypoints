const tags = require('../services/database/tags');
const { resolveActingOwner } = require('../services/authz/actingOwner');

const MAX_NAME_LENGTH = 40;

function serialize(tag) {
    return { id: tag._id, name: tag.name };
}

async function list(req, res) {
    const ctx = await resolveActingOwner(req, res);
    if (!ctx) return;
    const items = await tags.list(ctx.ownerId);
    res.json({ tags: items.map(serialize) });
}

async function create(req, res) {
    const ctx = await resolveActingOwner(req, res, { write: true });
    if (!ctx) return;
    const name = String((req.body || {}).name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (name.length > MAX_NAME_LENGTH) return res.status(400).json({ error: `name must be ${MAX_NAME_LENGTH} characters or fewer` });

    try {
        const tag = await tags.create({ owner: ctx.ownerId, name });
        res.status(201).json(serialize(tag));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A tag with that name already exists' });
        throw err;
    }
}

async function update(req, res) {
    const ctx = await resolveActingOwner(req, res, { write: true });
    if (!ctx) return;
    const name = String((req.body || {}).name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (name.length > MAX_NAME_LENGTH) return res.status(400).json({ error: `name must be ${MAX_NAME_LENGTH} characters or fewer` });

    try {
        const tag = await tags.update(req.params.id, { name }, ctx.ownerId);
        if (!tag) return res.status(404).json({ error: 'Not found' });
        res.json(serialize(tag));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A tag with that name already exists' });
        throw err;
    }
}

async function remove(req, res) {
    const ctx = await resolveActingOwner(req, res, { write: true });
    if (!ctx) return;
    const tag = await tags.remove(req.params.id, ctx.ownerId);
    if (!tag) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
}

module.exports = { list, create, update, remove };
