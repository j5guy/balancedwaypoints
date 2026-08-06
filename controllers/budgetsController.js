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
        })),
        incomeCategories: summary.incomeCategories.map(c => ({
            category: { id: c.category._id, name: c.category.name, group: c.category.group._id || c.category.group },
            activityCents: c.activityCents
        }))
    };
}

async function getMonth(req, res) {
    const { month } = req.params;
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be in YYYY-MM format' });
    const summary = await envelope.summary(month, req.session.userId);
    res.json(serializeSummary(summary));
}

async function assign(req, res) {
    const { month, categoryId } = req.params;
    const { assignedCents } = req.body || {};
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be in YYYY-MM format' });
    if (assignedCents === undefined || assignedCents === null) return res.status(400).json({ error: 'assignedCents is required' });

    await categoryBudgetsDb.assign(categoryId, month, Number(assignedCents), req.session.userId);
    const summary = await envelope.summary(month, req.session.userId);
    res.json(serializeSummary(summary));
}

// Bulk "copy last month's budget" (or any other month) — one assignedCents
// value per category, copied as-is rather than merged/added, same as if
// you'd retyped each one by hand.
async function copyFrom(req, res) {
    const { month } = req.params;
    const { fromMonth } = req.body || {};
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: 'month must be in YYYY-MM format' });
    if (!MONTH_RE.test(fromMonth)) return res.status(400).json({ error: 'fromMonth must be in YYYY-MM format' });
    if (fromMonth === month) return res.status(400).json({ error: "fromMonth can't be the same as month" });

    await categoryBudgetsDb.copyMonth(fromMonth, month, req.session.userId);
    const summary = await envelope.summary(month, req.session.userId);
    res.json(serializeSummary(summary));
}

module.exports = { getMonth, assign, copyFrom };
