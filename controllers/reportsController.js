const spendingByCategory = require('../services/reports/spendingByCategory');
const incomeVsExpense = require('../services/reports/incomeVsExpense');
const netWorth = require('../services/reports/netWorth');

async function spending(req, res) {
    const { from, to, month } = req.query;
    const rows = await spendingByCategory({ from, to, month });
    res.json({
        rows: rows.map(r => ({
            category: r.category ? { id: r.category._id, name: r.category.name } : null,
            totalCents: r.totalCents,
            assignedCents: r.assignedCents
        }))
    });
}

async function incomeExpense(req, res) {
    const { from, to } = req.query;
    const rows = await incomeVsExpense({ from, to });
    res.json({ rows });
}

async function netWorthReport(req, res) {
    const months = req.query.months ? Number(req.query.months) : 12;
    const rows = await netWorth({ months });
    res.json({ rows });
}

module.exports = { spending, incomeExpense, netWorthReport };
