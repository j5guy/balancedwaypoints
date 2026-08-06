const spendingByCategory = require('../services/reports/spendingByCategory');
const incomeVsExpense = require('../services/reports/incomeVsExpense');
const netWorth = require('../services/reports/netWorth');
const summary = require('../services/reports/summary');
const forecast = require('../services/reports/forecast');
const accountShares = require('../services/database/accountShares');

async function spending(req, res) {
    const { from, to, month } = req.query;
    const rows = await spendingByCategory({ from, to, month, ownerId: req.authUserId });
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
    const rows = await incomeVsExpense({ from, to, ownerId: req.authUserId });
    res.json({ rows });
}

async function netWorthReport(req, res) {
    const months = req.query.months ? Number(req.query.months) : 12;
    const rows = await netWorth({ months, ownerId: req.authUserId });
    res.json({ rows });
}

// Every other report in this file stays strictly req.authUserId-scoped —
// shared accounts don't appear in a collaborator's own Reports/Dashboard
// totals (see the Phase 2 plan). Summary and Forecast are the one
// exception: a Dashboard widget can be explicitly pointed at a single
// shared account, so when `account` names one that isn't the caller's own,
// resolve its real owner (any share role — these are read-only reports)
// instead of scoping to the caller.
async function ownerForAccount(req, res, accountId) {
    const access = await accountShares.resolveAccountAccess(accountId, req.authUserId);
    if (!access) {
        res.status(404).json({ error: 'Not found' });
        return null;
    }
    return access.ownerId;
}

async function summaryReport(req, res) {
    const { from, to, account } = req.query;
    const ownerId = account ? await ownerForAccount(req, res, account) : req.authUserId;
    if (account && !ownerId) return;
    const result = await summary({ from, to, accountId: account || null, ownerId });
    res.json(result);
}

const FORECAST_UNITS = ['days', 'weeks', 'months', 'years'];

async function forecastReport(req, res) {
    const { account, pastAmount, pastUnit, futureAmount, futureUnit } = req.query;
    if (!account) return res.status(400).json({ error: 'account is required' });
    const ownerId = await ownerForAccount(req, res, account);
    if (!ownerId) return;
    const rows = await forecast({
        accountId: account,
        pastAmount: pastAmount ? Number(pastAmount) : 10,
        pastUnit: FORECAST_UNITS.includes(pastUnit) ? pastUnit : 'days',
        futureAmount: futureAmount ? Number(futureAmount) : 6,
        futureUnit: FORECAST_UNITS.includes(futureUnit) ? futureUnit : 'months',
        ownerId
    });
    res.json({ rows });
}

module.exports = { spending, incomeExpense, netWorthReport, summaryReport, forecastReport };
