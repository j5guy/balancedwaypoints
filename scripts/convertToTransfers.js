// One-off cleanup for transactions that were categorized as a stand-in for
// a real transfer (e.g. "To Bill Savings" / "From Bill Savings") instead of
// using this app's actual Transfer type (models/transaction.js's
// transferAccount/transferId — see services/database/transactions.js's
// createTransfer). Those categorized rows count as real spending/income in
// every report, which is wrong for money that never left the household.
//
// This assumes BOTH sides of each transfer already exist as separate
// transactions (one deducting from the source account, one crediting the
// destination account) — it does not create anything new, it just matches
// up existing pairs (by opposite amount + nearby date, since bank posting
// dates for the two sides of a transfer often don't land on the same
// calendar day) and links them into a proper transfer, clearing their
// category so they drop out of income/expense/spending reports.
//
// Defaults to a DRY RUN — prints exactly what it would do and makes no
// writes. Re-run with --apply once the dry-run output looks right. Back up
// your database before running with --apply; this rewrites real
// transaction records.
//
// Usage:
//   node scripts/convertToTransfers.js "To Bill Savings" "From Bill Savings" "Checking" "Bill Savings" [--apply]
//
// The two category names and two account names must match exactly
// (case-sensitive) what's shown in this app's UI.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const buildMongoUri = require('../config/mongoUri');
const Transaction = require('../models/transaction');
const Category = require('../models/category');
const Account = require('../models/account');

const DATE_TOLERANCE_DAYS = 3;

const args = process.argv.slice(2).filter(a => a !== '--apply');
const APPLY = process.argv.includes('--apply');
const [categoryNameA, categoryNameB, accountNameA, accountNameB] = args;

if (!categoryNameA || !categoryNameB || !accountNameA || !accountNameB) {
    console.error('Usage: node scripts/convertToTransfers.js "<category A>" "<category B>" "<account A>" "<account B>" [--apply]');
    process.exit(1);
}

function money(cents) {
    return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function dateKey(d) {
    return new Date(d).toISOString().slice(0, 10);
}

async function run() {
    await mongoose.connect(buildMongoUri());

    const [categoryA, categoryB, accountA, accountB] = await Promise.all([
        Category.findOne({ name: categoryNameA }),
        Category.findOne({ name: categoryNameB }),
        Account.findOne({ name: accountNameA }),
        Account.findOne({ name: accountNameB })
    ]);

    const missing = [
        !categoryA && `category "${categoryNameA}"`,
        !categoryB && `category "${categoryNameB}"`,
        !accountA && `account "${accountNameA}"`,
        !accountB && `account "${accountNameB}"`
    ].filter(Boolean);
    if (missing.length) {
        console.error(`Not found: ${missing.join(', ')}. Names must match exactly (case-sensitive).`);
        await mongoose.disconnect();
        return;
    }

    const categoryIds = [categoryA._id, categoryB._id];
    const accountIds = [accountA._id, accountB._id];

    // Only candidates already on one of the two named accounts, under one
    // of the two named categories, not already part of a transfer.
    const candidates = await Transaction.find({
        category: { $in: categoryIds },
        account: { $in: accountIds },
        transferId: null
    }).sort({ date: 1 }).lean();

    console.log(`Found ${candidates.length} candidate transaction(s) under "${categoryNameA}"/"${categoryNameB}" on ${accountNameA}/${accountNameB}.\n`);

    const matched = [];
    const usedIds = new Set();

    for (const txn of candidates) {
        if (usedIds.has(String(txn._id))) continue;

        const windowStart = new Date(txn.date);
        windowStart.setDate(windowStart.getDate() - DATE_TOLERANCE_DAYS);
        const windowEnd = new Date(txn.date);
        windowEnd.setDate(windowEnd.getDate() + DATE_TOLERANCE_DAYS);

        // Counterpart: the OTHER of the two named accounts (not "any other
        // account" — narrowly scoped on purpose, so an unrelated coincidence
        // elsewhere in the ledger can't get misread as this transfer's other
        // side), opposite sign, same magnitude, nearby date, not already a
        // transfer. No category filter — the other side may never have been
        // categorized at all, or use different categories than this side.
        const otherAccountId = String(txn.account) === String(accountA._id) ? accountB._id : accountA._id;
        // Excludes already-claimed ids at the query level (not just checked
        // after) — otherwise, if the best/only match on amount+date happens
        // to already be spoken for by an earlier txn in this loop, this txn
        // would wrongly fall back to "unmatched" instead of finding the
        // next real candidate (relevant when more than one transfer of the
        // same amount happened on nearby dates).
        // eslint-disable-next-line no-await-in-loop
        const counterpart = await Transaction.findOne({
            _id: { $ne: txn._id, $nin: [...usedIds] },
            account: otherAccountId,
            amountCents: -txn.amountCents,
            date: { $gte: windowStart, $lte: windowEnd },
            transferId: null
        }).lean();

        if (counterpart) {
            matched.push({ a: txn, b: counterpart });
            usedIds.add(String(txn._id));
            usedIds.add(String(counterpart._id));
        }
    }

    const unmatched = candidates.filter(c => !usedIds.has(String(c._id)));

    console.log(`Matched ${matched.length} pair(s):`);
    matched.forEach(({ a, b }) => {
        console.log(`  ${dateKey(a.date)}  ${money(Math.abs(a.amountCents))}   ${String(a.account) === String(accountA._id) ? accountNameA : accountNameB} <-> ${String(b.account) === String(accountA._id) ? accountNameA : accountNameB}`);
    });

    if (unmatched.length) {
        console.log(`\n${unmatched.length} transaction(s) had NO matching counterpart within ${DATE_TOLERANCE_DAYS} day(s) — left untouched, review these by hand:`);
        unmatched.forEach((u) => {
            console.log(`  id=${u._id}  ${dateKey(u.date)}  ${money(u.amountCents)}  notes="${u.notes || ''}"`);
        });
    }

    if (!APPLY) {
        console.log('\nDry run only — no changes made. Re-run with --apply to write these changes.');
        await mongoose.disconnect();
        return;
    }

    for (const { a, b } of matched) {
        const transferId = new mongoose.Types.ObjectId();
        // eslint-disable-next-line no-await-in-loop
        await Transaction.updateOne(
            { _id: a._id },
            { $set: { transferId, transferAccount: b.account, category: null }, $unset: { splits: 1 } }
        );
        // eslint-disable-next-line no-await-in-loop
        await Transaction.updateOne(
            { _id: b._id },
            { $set: { transferId, transferAccount: a.account, category: null }, $unset: { splits: 1 } }
        );
    }
    console.log(`\nConverted ${matched.length} pair(s) into linked transfers.`);
    console.log(`"${categoryNameA}" and "${categoryNameB}" now have no transactions left under ${unmatched.length ? 'except the unmatched ones listed above' : 'them'} — safe to delete from Budget once you're satisfied.`);

    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
