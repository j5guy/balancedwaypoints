const envelope = require('../services/budget/envelope');
const categoryBudgetsDb = require('../services/database/categoryBudgets');

const MONTH_RE = /^\d{4}-\d{2}$/;

function serializeSummary(summary) {
    return {
        month: summary.month,
        readyToAssignCents: summary.readyToAssignCents,
        onBudgetBalanceCents: summary.onBudgetBalanceCents,
        categories: summary.categories.map(c => ({
            category: { id: c.category._id, name: c.category.name, group: c.category.group._id || c.category.group },
            assignedCents: c.assignedCents,
            activityCents: c.activityCents,
            balanceCents: c.balanceCents
        }))
    };
}

async function getMonth(req, res) {
    const { month } = req.params;
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be in YYYY-MM format' });
    const summary = await envelope.summary(month);
    res.json(serializeSummary(summary));
}

async function assign(req, res) {
    const { month, categoryId } = req.params;
    const { assignedCents } = req.body || {};
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be in YYYY-MM format' });
    if (assignedCents === undefined || assignedCents === null) return res.status(400).json({ error: 'assignedCents is required' });

    await categoryBudgetsDb.assign(categoryId, month, Number(assignedCents));
    const summary = await envelope.summary(month);
    res.json(serializeSummary(summary));
}

module.exports = { getMonth, assign };
