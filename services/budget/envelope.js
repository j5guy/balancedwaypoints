// Envelope-budgeting math (YNAB/Actual-style "Ready to Assign" + rolling
// per-category balances). Nothing here is stored — it's all derived on read
// from Account.startingBalanceCents, CategoryBudget rows, and Transaction
// amounts, so there's never a stored balance to get out of sync.
//
// Simplification made for v1: every figure is computed "as of the end of the
// viewed month" (assigned/activity up to and including that month, ignoring
// anything dated after it). That keeps the core invariant exactly true for
// whatever month you're looking at:
//
//   sum(on-budget account balances through that month)
//     = readyToAssignCents + sum(category balances through that month)
//
// One consequence: assigning money to a future month before it arrives isn't
// supported (Ready to Assign only reflects the viewed month and earlier).
const mongoose = require('mongoose');
const Account = require('../../models/account');
const Transaction = require('../../models/transaction');
const categoriesDb = require('../database/categories');
const categoryBudgetsDb = require('../database/categoryBudgets');

function monthEndExclusive(month) {
    const [year, monthNum] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthNum, 1)); // first instant of the following month
}

async function onBudgetAccountBalanceThroughMonth(month) {
    const end = monthEndExclusive(month);
    const accounts = await Account.find({ onBudget: true }).exec();
    if (accounts.length === 0) return 0;
    const ids = accounts.map(a => a._id);
    const startingTotal = accounts.reduce((sum, a) => sum + a.startingBalanceCents, 0);
    const [agg] = await Transaction.aggregate([
        { $match: { account: { $in: ids }, date: { $lt: end } } },
        { $group: { _id: null, total: { $sum: '$amountCents' } } }
    ]);
    return startingTotal + (agg ? agg.total : 0);
}

async function activityForCategoryThroughMonth(categoryId, month, { exact = false } = {}) {
    const end = monthEndExclusive(month);
    const dateFilter = exact
        ? { $gte: new Date(`${month}-01T00:00:00.000Z`), $lt: end }
        : { $lt: end };
    const catId = new mongoose.Types.ObjectId(categoryId);

    const [direct] = await Transaction.aggregate([
        { $match: { category: catId, date: dateFilter } },
        { $group: { _id: null, total: { $sum: '$amountCents' } } }
    ]);
    const [splitAgg] = await Transaction.aggregate([
        { $match: { 'splits.category': catId, date: dateFilter } },
        { $unwind: '$splits' },
        { $match: { 'splits.category': catId } },
        { $group: { _id: null, total: { $sum: '$splits.amountCents' } } }
    ]);
    return (direct ? direct.total : 0) + (splitAgg ? splitAgg.total : 0);
}

// Full summary for the budget page: per-category assigned/activity for the
// viewed month plus its rolling balance, and the top-line Ready to Assign.
async function summary(month) {
    const categories = await categoriesDb.list();
    const budgetable = categories.filter(c => !c.group.isIncome);
    const budgetRows = await categoryBudgetsDb.upToMonth(month);

    const assignedThroughMonthByCategory = new Map();
    const assignedThisMonthByCategory = new Map();
    budgetRows.forEach(row => {
        const key = String(row.category);
        assignedThroughMonthByCategory.set(key, (assignedThroughMonthByCategory.get(key) || 0) + row.assignedCents);
        if (row.month === month) assignedThisMonthByCategory.set(key, row.assignedCents);
    });

    const categoryResults = await Promise.all(budgetable.map(async (category) => {
        const key = String(category._id);
        const assignedThroughMonth = assignedThroughMonthByCategory.get(key) || 0;
        const assignedThisMonth = assignedThisMonthByCategory.get(key) || 0;
        const activityThroughMonth = await activityForCategoryThroughMonth(category._id, month);
        const activityThisMonth = await activityForCategoryThroughMonth(category._id, month, { exact: true });
        return {
            category,
            assignedCents: assignedThisMonth,
            activityCents: activityThisMonth,
            balanceCents: assignedThroughMonth + activityThroughMonth
        };
    }));

    const totalCategoryBalance = categoryResults.reduce((sum, c) => sum + c.balanceCents, 0);
    const onBudgetBalance = await onBudgetAccountBalanceThroughMonth(month);
    const readyToAssignCents = onBudgetBalance - totalCategoryBalance;

    return {
        month,
        readyToAssignCents,
        onBudgetBalanceCents: onBudgetBalance,
        categories: categoryResults
    };
}

module.exports = { summary, monthEndExclusive, onBudgetAccountBalanceThroughMonth, activityForCategoryThroughMonth };
