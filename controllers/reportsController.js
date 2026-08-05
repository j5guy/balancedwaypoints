const spendingByCategory = require('../services/reports/spendingByCategory');
const incomeVsExpense = require('../services/reports/incomeVsExpense');
const netWorth = require('../services/reports/netWorth');
const summary = require('../services/reports/summary');
const forecast = require('../services/reports/forecast');

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

async function summaryReport(req, res) {
    const { from, to, account } = req.query;
    const result = await summary({ from, to, accountId: account || null });
    res.json(result);
}

const FORECAST_UNITS = ['days', 'weeks', 'months', 'years'];

async function forecastReport(req, res) {
    const { account, pastDays, futureAmount, futureUnit } = req.query;
    if (!account) return res.status(400).json({ error: 'account is required' });
    const rows = await forecast({
        accountId: account,
        pastDays: pastDays ? Number(pastDays) : 10,
        futureAmount: futureAmount ? Number(futureAmount) : 6,
        futureUnit: FORECAST_UNITS.includes(futureUnit) ? futureUnit : 'months'
    });
    res.json({ rows });
}

module.exports = { spending, incomeExpense, netWorthReport, summaryReport, forecastReport };
