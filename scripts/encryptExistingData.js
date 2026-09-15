// One-time migration for the move to field-level encryption of sensitive
// free text at rest (see utils/secretCrypto.js and
// services/database/notesCrypto.js): Payee name/address/phone/accountNumber,
// and every notes field — Transaction.notes/splits[].notes,
// Schedule.notes/splits[].notes/occurrenceOverrides[].notes/
// occurrenceOverrides[].splits[].notes, and Account.notes.
//
// Existing installs have this data in plaintext (models used to have a
// plain `name`/`notes` String field where they now have `<field>Iv`/
// `<field>Ciphertext`). This script reads every document with the OLD
// plaintext field still present, encrypts it, writes the new fields, and
// unsets the old one. Safe to re-run — a document with no plaintext field
// left (already migrated, or created fresh after this version) is skipped.
//
// Requires `sessionSecret` to already be set to its real, final value
// (the .env this app already uses in production) — this is the FIRST thing
// that gets derived into an encryption key, so run this only after you've
// settled on a permanent sessionSecret, not a placeholder.
//
// A pre-migration mongodump restored after upgrading will be missing the
// new required fields (e.g. Payee.nameHash) — re-run this script once after
// restoring an old backup onto a new-schema install.
//
// BACK UP YOUR DATABASE BEFORE RUNNING THIS.
//
// Usage:
//   node scripts/encryptExistingData.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const buildMongoUri = require('../config/mongoUri');
const { encrypt, hashLookup } = require('../utils/secretCrypto');
const { encryptNotes, encryptSplitsForWrite } = require('../services/database/notesCrypto');

const Account = require('../models/account');
const Payee = require('../models/payee');
const Transaction = require('../models/transaction');
const Schedule = require('../models/schedule');

if (!process.env.sessionSecret) {
    console.error('sessionSecret is not set — see .env. Refusing to run (nothing would be recoverable).');
    process.exit(1);
}

async function migratePayees() {
    const raw = await Payee.collection.find({ name: { $exists: true } }).toArray();
    console.log(`Payees: ${raw.length} with a plaintext name to migrate.`);
    for (const doc of raw) {
        const { iv, ciphertext } = encrypt(doc.name);
        const set = { nameIv: iv, nameCiphertext: ciphertext, nameHash: hashLookup(doc.name) };
        const unset = { name: '' };
        if (doc.address !== undefined) { Object.assign(set, prefixedEncrypt('address', doc.address)); unset.address = ''; }
        if (doc.phone !== undefined) { Object.assign(set, prefixedEncrypt('phone', doc.phone)); unset.phone = ''; }
        if (doc.accountNumber !== undefined) { Object.assign(set, prefixedEncrypt('accountNumber', doc.accountNumber)); unset.accountNumber = ''; }
        // eslint-disable-next-line no-await-in-loop
        await Payee.collection.updateOne({ _id: doc._id }, { $set: set, $unset: unset });
    }
}

function prefixedEncrypt(field, value) {
    const { iv, ciphertext } = encrypt(value || '');
    return { [`${field}Iv`]: iv, [`${field}Ciphertext`]: ciphertext };
}

async function migrateNotesField(Model, label) {
    const raw = await Model.collection.find({ notes: { $exists: true } }).toArray();
    console.log(`${label}: ${raw.length} with a plaintext top-level notes to migrate.`);
    for (const doc of raw) {
        // eslint-disable-next-line no-await-in-loop
        await Model.collection.updateOne(
            { _id: doc._id },
            { $set: encryptNotes(doc.notes), $unset: { notes: '' } }
        );
    }
}

// Transaction/Schedule splits are subdocuments — rewritten wholesale via
// encryptSplitsForWrite() (it doesn't touch category/amountCents, just
// swaps each split's plaintext `notes` for notesIv/notesCiphertext).
async function migrateSplits(Model, label) {
    const raw = await Model.collection.find({ 'splits.notes': { $exists: true } }).toArray();
    console.log(`${label}: ${raw.length} with plaintext splits[].notes to migrate.`);
    for (const doc of raw) {
        // eslint-disable-next-line no-await-in-loop
        await Model.collection.updateOne(
            { _id: doc._id },
            { $set: { splits: encryptSplitsForWrite(doc.splits) } }
        );
    }
}

// Schedule.occurrenceOverrides is an array of full snapshots, each with its
// own notes + nested splits — same treatment as the base schedule, per entry.
async function migrateOccurrenceOverrides() {
    const raw = await Schedule.collection.find({ 'occurrenceOverrides.notes': { $exists: true } }).toArray();
    console.log(`Schedules: ${raw.length} with plaintext occurrenceOverrides[].notes to migrate.`);
    for (const doc of raw) {
        const migrated = (doc.occurrenceOverrides || []).map((o) => {
            const { notes, splits, ...rest } = o;
            return { ...rest, ...encryptNotes(notes), splits: encryptSplitsForWrite(splits) };
        });
        // eslint-disable-next-line no-await-in-loop
        await Schedule.collection.updateOne({ _id: doc._id }, { $set: { occurrenceOverrides: migrated } });
    }
}

async function run() {
    await mongoose.connect(buildMongoUri());

    await migratePayees();
    await migrateNotesField(Transaction, 'Transactions');
    await migrateSplits(Transaction, 'Transactions');
    await migrateNotesField(Schedule, 'Schedules');
    await migrateSplits(Schedule, 'Schedules (base splits)');
    await migrateOccurrenceOverrides();
    await migrateNotesField(Account, 'Accounts');

    console.log('\nDone.');
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
