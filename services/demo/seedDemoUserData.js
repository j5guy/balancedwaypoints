// Generates one full private starter dataset for a single new demo user —
// unlike a shared library, this runs fresh on every /demo signup and
// everything it creates is scoped to that one `owner`, so no two demo
// accounts ever share a document. See controllers/demoController.js.
const Account = require('../../models/account');
const CategoryGroup = require('../../models/categoryGroup');
const Category = require('../../models/category');
const CategoryBudget = require('../../models/categoryBudget');
const Transaction = require('../../models/transaction');
const Rule = require('../../models/rule');
const Schedule = require('../../models/schedule');
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

const PAYEES = ['Employer Inc.', 'Landlord Properties', 'Fresh Market', 'City Electric', 'Gas & Go', 'Corner Coffee', 'Local Bistro', 'Cineplex', 'Amazon', 'Streamflix'];

// Rules: a name, its match conditions, and its actions — categoryName is
// resolved to that category's id at seed time (see categoriesByName below),
// so this stays readable instead of a raw ObjectId. Chosen to actually fire
// against the payees seeded above, so a demo visitor who runs "Apply rules"
// on the register sees them do something real.
const RULE_DEFS = [
    {
        name: 'Amazon → Shopping', priority: 1,
        conditions: [{ field: 'payee', operator: 'contains', value: 'Amazon' }],
        actions: [{ type: 'setCategory', categoryName: 'Shopping' }]
    },
    {
        name: 'Coffee → Dining Out', priority: 2,
        conditions: [{ field: 'payee', operator: 'contains', value: 'Coffee' }],
        actions: [{ type: 'setCategory', categoryName: 'Dining Out' }, { type: 'addTag', value: 'coffee' }]
    },
    {
        name: 'Gas & Go → Transportation', priority: 3,
        conditions: [{ field: 'payee', operator: 'contains', value: 'Gas & Go' }],
        actions: [{ type: 'setCategory', categoryName: 'Transportation' }]
    }
];

// Schedules, one of each shape the app supports, so a demo visitor sees the
// full feature set on day one instead of an empty Schedules page: a plain
// auto-entered recurring income/expense (Paycheck, Electric Bill), an
// autopay bill (Rent, Streaming Service — badge shown in the register), a
// reminder-only schedule that never posts itself (Electric Bill), and a
// recurring transfer (Savings Transfer). daysFromNow anchors each one a
// little past the last matching transaction buildTransactionDefs() already
// seeded, so "next due" always looks like a believable continuation rather
// than something already overdue.
const SCHEDULE_DEFS = [
    {
        name: 'Paycheck', accountKey: 'checking', payee: 'Employer Inc.', category: 'Paycheck',
        amountCents: 260000, daysFromNow: 11, frequency: { kind: 'interval', unit: 'weeks', interval: 2 },
        autoEnter: true
    },
    {
        name: 'Rent', accountKey: 'checking', payee: 'Landlord Properties', category: 'Rent',
        amountCents: -150000, daysFromNow: 28, frequency: { kind: 'dayOfMonth', day: 1 },
        autoEnter: true, autopay: true
    },
    {
        name: 'Electric Bill', accountKey: 'checking', payee: 'City Electric', category: 'Utilities',
        amountCents: -18000, daysFromNow: 22, frequency: { kind: 'dayOfMonth', day: 8 },
        autoEnter: false, reminderDaysBefore: 5
    },
    {
        name: 'Streaming Service', accountKey: 'creditCard', payee: 'Streamflix', category: 'Entertainment',
        amountCents: -1599, daysFromNow: 14, frequency: { kind: 'dayOfMonth', day: 20 },
        autoEnter: true, autopay: true, notifyByEmail: true
    },
    {
        name: 'Savings Transfer', accountKey: 'checking', transferToKey: 'savings',
        amountCents: -50000, daysFromNow: 19, frequency: { kind: 'interval', unit: 'months', interval: 1 },
        autoEnter: true
    }
];

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

// Normalized to UTC midnight of "today" in server-local time (server.js pins
// process.env.TZ to America/New_York, so plain getFullYear/getMonth/getDate
// below already reflect that, not UTC) — matching how a real
// <input type="date"> entry is stored (see public/js/date.js). Anchoring on
// UTC's own calendar day instead would make "today"'s seeded transactions
// dated a day ahead for anyone viewing from America/New_York in the evening,
// since UTC is already into tomorrow by then. Using a plain time-of-day
// instead of midnight has the same problem as the UTC anchor did: it can
// push a same-calendar-day transaction past a reconcile statement date's
// $lte midnight cutoff (services/database/transactions.js's list()).
function daysAgoToDate(daysAgo) {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo));
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

    for (const def of RULE_DEFS) {
        await Rule.create({
            owner: ownerId,
            name: def.name,
            priority: def.priority,
            conditions: def.conditions,
            actions: def.actions.map((action) => (
                action.type === 'setCategory'
                    ? { type: 'setCategory', value: categoriesByName[action.categoryName]._id.toString() }
                    : action
            ))
        });
    }

    for (const def of SCHEDULE_DEFS) {
        await Schedule.create({
            owner: ownerId,
            name: def.name,
            account: accountsByKey[def.accountKey]._id,
            amountCents: def.amountCents,
            payee: def.payee ? payeesByName[def.payee]._id : null,
            category: def.category ? categoriesByName[def.category]._id : null,
            transferAccount: def.transferToKey ? accountsByKey[def.transferToKey]._id : null,
            frequency: def.frequency,
            nextDate: daysAgoToDate(-def.daysFromNow),
            autoEnter: !!def.autoEnter,
            autopay: !!def.autopay,
            notifyByEmail: !!def.notifyByEmail,
            reminderDaysBefore: def.reminderDaysBefore !== undefined ? def.reminderDaysBefore : 3
        });
    }
}

module.exports = seedDemoUserData;
