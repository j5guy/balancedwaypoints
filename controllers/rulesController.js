const rules = require('../services/database/rules');
const { CONDITION_FIELDS, CONDITION_OPERATORS, ACTION_TYPES } = require('../models/rule');

function serialize(rule) {
    return {
        id: rule._id,
        name: rule.name,
        priority: rule.priority,
        stopProcessing: rule.stopProcessing,
        conditions: rule.conditions,
        actions: rule.actions,
        active: rule.active
    };
}

function validate({ conditions, actions }) {
    for (const c of conditions || []) {
        if (!CONDITION_FIELDS.includes(c.field)) return `Invalid condition field: ${c.field}`;
        if (!CONDITION_OPERATORS.includes(c.operator)) return `Invalid condition operator: ${c.operator}`;
    }
    for (const a of actions || []) {
        if (!ACTION_TYPES.includes(a.type)) return `Invalid action type: ${a.type}`;
    }
    return null;
}

async function list(req, res) {
    const items = await rules.list(req.session.userId);
    res.json({ rules: items.map(serialize) });
}

async function create(req, res) {
    const { name, priority, stopProcessing, conditions, actions, active } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'name is required' });
    const error = validate({ conditions, actions });
    if (error) return res.status(400).json({ error });

    const rule = await rules.create({
        owner: req.session.userId,
        name: String(name).trim(),
        priority: Number(priority) || 0,
        stopProcessing: !!stopProcessing,
        conditions: conditions || [],
        actions: actions || [],
        active: active !== false
    });
    res.status(201).json(serialize(rule));
}

async function update(req, res) {
    const { name, priority, stopProcessing, conditions, actions, active } = req.body || {};
    const error = validate({ conditions, actions });
    if (error) return res.status(400).json({ error });

    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (priority !== undefined) data.priority = Number(priority) || 0;
    if (stopProcessing !== undefined) data.stopProcessing = !!stopProcessing;
    if (conditions !== undefined) data.conditions = conditions;
    if (actions !== undefined) data.actions = actions;
    if (active !== undefined) data.active = !!active;

    const rule = await rules.update(req.params.id, data, req.session.userId);
    if (!rule) return res.status(404).json({ error: 'Not found' });
    res.json(serialize(rule));
}

async function remove(req, res) {
    const rule = await rules.remove(req.params.id, req.session.userId);
    if (!rule) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
}

module.exports = { list, create, update, remove };
