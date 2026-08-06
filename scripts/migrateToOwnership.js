// One-time migration for the move from one shared household dataset to
// per-user ownership (models/*.js's new `owner` field on Account, Category,
// CategoryGroup, Payee, Schedule, Rule, CategoryBudget, Transaction, Tag).
// Every document that exists today belongs to the single shared household —
// this assigns ALL of it to one specific user, identified by email (not
// auto-detected: authSource:'ldap' has no uniqueness guarantee, so this
// takes an explicit email rather than guessing at "the" LDAP user). Every
// other existing account ends up owning nothing — a real blank slate,
// exactly as intended.
//
// BACK UP YOUR DATABASE BEFORE RUNNING THIS. It rewrites every document in
// 9 collections. Safe to re-run (idempotent) — a second run just reassigns
// the same owner again.
//
// Usage:
//   node scripts/migrateToOwnership.js <owner-email>
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const buildMongoUri = require('../config/mongoUri');
const usersDb = require('../services/database/users');

const Account = require('../models/account');
const Category = require('../models/category');
const CategoryGroup = require('../models/categoryGroup');
const Payee = require('../models/payee');
const Schedule = require('../models/schedule');
const Rule = require('../models/rule');
const CategoryBudget = require('../models/categoryBudget');
const Transaction = require('../models/transaction');
const Tag = require('../models/tag');

const MODELS = [
    ['Accounts', Account],
    ['Categories', Category],
    ['Category groups', CategoryGroup],
    ['Payees', Payee],
    ['Schedules', Schedule],
    ['Rules', Rule],
    ['Category budgets', CategoryBudget],
    ['Transactions', Transaction],
    ['Tags', Tag]
];

const email = process.argv[2];
if (!email) {
    console.error('Usage: node scripts/migrateToOwnership.js <owner-email>');
    process.exit(1);
}

async function run() {
    await mongoose.connect(buildMongoUri());

    const owner = await usersDb.findByEmail(email);
    if (!owner) {
        console.error(`No user found with email "${email}". Names/emails must match exactly.`);
        await mongoose.disconnect();
        return;
    }

    console.log(`Assigning all existing data to "${owner.email}" (${owner._id})...\n`);
    for (const [label, Model] of MODELS) {
        const result = await Model.updateMany({}, { $set: { owner: owner._id } }).exec();
        console.log(`  ${label}: ${result.modifiedCount} updated (${result.matchedCount} matched)`);
    }

    console.log('\nDone. Every other existing account now owns nothing until you invite/re-add their own data.');
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
