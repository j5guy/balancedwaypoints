// Generates one full private starter dataset for a single new demo user —
// unlike a shared library, this runs fresh on every /demo signup and
// everything it creates is scoped to that one `owner`, so no two demo
// accounts ever share a document. See controllers/demoController.js.
const Account = require('../../models/account');
const CategoryGroup = require('../../models/categoryGroup');
const Category = require('../../models/category');
const CategoryBudget = require('../../models/categoryBudget');
const Transaction = require('../../models/transaction');
const transactionsDb = require('../database/transactions');
const payeesDb = require('../database/payees');

const ACCOUNTS = [
    { key: 'checking', name: 'Checking', type: 'checking', startingBalanceCents: 250000 },
    { key: 'savings', name: 'Savings', type: 'savings', startingBalanceCents: 800000 },
    { key: 'creditCard', name: 'Credit Card', type: 'credit', startingBalanceCents: -45000 }
];

// [groupName, isIncome, [categoryName, ...]]
const CATEGORY_GROUPS = [
    ['Income', true, ['Paycheck']],
    ['Essentials', false, ['Rent', 'Groceries', 'Utilities', 'Transportation']],
    ['Lifestyle', false, ['Dining Out', 'Entertainment', 'Shopping']]
];

const PAYEES = ['Employer Inc.', 'Landlord Properties', 'Fresh Market', 'City Electric', 'Gas & Go', 'Corner Coffee', 'Local Bistro', 'Cineplex', 'Amazon'];

// Current month's envelope assignments — category name -> assigned cents.
const BUDGET_ASSIGNMENTS = {
    Rent: 150000,
    Groceries: 60000,
    Utilities: 20000,
    Transportation: 15000,
    'Dining Out': 20000,
    Entertainment: 10000,
    Shopping: 15000
};

// Transaction templates, dated relative to "today" so the demo always looks
// current. accountKey/payee/category reference the maps built below;
// transfer entries move money between two of this user's own accounts.
function buildTransactionDefs() {
    const defs = [];

    // Biweekly paycheck for the last ~2.5 months.
    for (let daysAgo = 3; daysAgo <= 80; daysAgo += 14) {
        defs.push({ daysAgo, accountKey: 'checking', payee: 'Employer Inc.', category: 'Paycheck', amountCents: 260000, cleared: daysAgo > 3 ? 'reconciled' : 'cleared' });
    }

    // Monthly rent, on/around the 1st for the last 3 months.
    for (const daysAgo of [2, 32, 62]) {
        defs.push({ daysAgo, accountKey: 'checking', payee: 'Landlord Properties', category: 'Rent', amountCents: -150000, cleared: 'reconciled' });
    }

    // Monthly utility bill.
    for (const daysAgo of [8, 38, 68]) {
        defs.push({ daysAgo, accountKey: 'checking', payee: 'City Electric', category: 'Utilities', amountCents: -18000, cleared: 'reconciled' });
    }

    // Groceries, a handful of trips a month.
    const groceryAmounts = [-8500, -6200, -9100, -5400, -7300, -6800];
    groceryAmounts.forEach((amountCents, i) => {
        defs.push({ daysAgo: 4 + i * 9, accountKey: 'checking', payee: 'Fresh Market', category: 'Groceries', amountCents, cleared: i < 4 ? 'reconciled' : 'cleared' });
    });

    // Gas fill-ups.
    [5, 19, 33, 47].forEach((daysAgo) => {
        defs.push({ daysAgo, accountKey: 'checking', payee: 'Gas & Go', category: 'Transportation', amountCents: -4200, cleared: 'reconciled' });
    });

    // Dining out / coffee, mostly on the credit card.
    [1, 6, 13, 20, 27].forEach((daysAgo, i) => {
        defs.push({ daysAgo, accountKey: 'creditCard', payee: i % 2 === 0 ? 'Corner Coffee' : 'Local Bistro', category: 'Dining Out', amountCents: i % 2 === 0 ? -650 : -3400, cleared: daysAgo > 5 ? 'cleared' : 'pending' });
    });

    // Entertainment and shopping.
    defs.push({ daysAgo: 10, accountKey: 'creditCard', payee: 'Cineplex', category: 'Entertainment', amountCents: -3200, cleared: 'cleared' });
    defs.push({ daysAgo: 24, accountKey: 'creditCard', payee: 'Cineplex', category: 'Entertainment', amountCents: -2800, cleared: 'cleared' });
    defs.push({ daysAgo: 15, accountKey: 'creditCard', payee: 'Amazon', category: 'Shopping', amountCents: -7900, cleared: 'cleared' });
    defs.push({ daysAgo: 41, accountKey: 'creditCard', payee: 'Amazon', category: 'Shopping', amountCents: -4300, cleared: 'reconciled' });

    // Most recent paycheck's balance is left pending/uncleared so the
    // register has something realistic to reconcile.
    defs.push({ daysAgo: 0, accountKey: 'creditCard', payee: 'Corner Coffee', category: 'Dining Out', amountCents: -550, cleared: 'pending' });

    return defs;
}

// [daysAgo, fromAccountKey, toAccountKey, amountCents] — a transfer creates
// a linked pair of Transaction docs (see models/transaction.js's
// transferAccount/transferId), not a category.
const TRANSFER_DEFS = [
    [9, 'checking', 'savings', 50000],
    [23, 'checking', 'savings', 50000],
    [5, 'checking', 'creditCard', 30000]
];

function daysAgoToDate(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date;
}

async function seedDemoUserData(ownerId) {
    const accountsByKey = {};
    for (const def of ACCOUNTS) {
        accountsByKey[def.key] = await Account.create({
            owner: ownerId,
            name: def.name,
            type: def.type,
            startingBalanceCents: def.startingBalanceCents
        });
    }

    const categoriesByName = {};
    for (const [groupName, isIncome, categoryNames] of CATEGORY_GROUPS) {
        const group = await CategoryGroup.create({ owner: ownerId, name: groupName, isIncome });
        for (const categoryName of categoryNames) {
            categoriesByName[categoryName] = await Category.create({ owner: ownerId, name: categoryName, group: group._id });
        }
    }

    const payeesByName = {};
    for (const name of PAYEES) {
        payeesByName[name] = await payeesDb.create({ owner: ownerId, name });
    }

    const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    for (const [categoryName, assignedCents] of Object.entries(BUDGET_ASSIGNMENTS)) {
        await CategoryBudget.create({ owner: ownerId, category: categoriesByName[categoryName]._id, month, assignedCents });
    }

    for (const def of buildTransactionDefs()) {
        await Transaction.create({
            owner: ownerId,
            account: accountsByKey[def.accountKey]._id,
            date: daysAgoToDate(def.daysAgo),
            payee: payeesByName[def.payee]._id,
            category: categoriesByName[def.category]._id,
            amountCents: def.amountCents,
            cleared: def.cleared
        });
    }

    for (const [daysAgo, fromKey, toKey, amountCents] of TRANSFER_DEFS) {
        await transactionsDb.createTransfer({
            owner: ownerId,
            fromAccount: accountsByKey[fromKey]._id,
            toAccount: accountsByKey[toKey]._id,
            date: daysAgoToDate(daysAgo),
            amountCents
        });
    }
}

module.exports = seedDemoUserData;
