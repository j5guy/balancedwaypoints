// One-time repair for a class of bug, not just one index: every collection
// the "Adding multi-tenancy" migration added an `owner` field to also had an
// existing UNIQUE index that predated `owner` entirely (e.g. CategoryGroup's
// name field was simply `unique: true` — a bare, global `name_1` index).
// Mongoose's autoIndex only ever ADDS indexes declared in the current
// schema; it never drops ones that used to exist but no longer match. So
// those old, non-owner-scoped unique indexes are still live in the database,
// still enforced, and still block anything colliding with data owned by
// ANY user (or by no user at all, from before `owner` existed) — even
// though the current schema's own index would happily allow it. Confirmed
// live via the CategoryGroup case: creating "Misc Expenses" for one owner
// fails with `E11000 ... index: name_1 dup key: { name: "Misc Expenses" }`,
// and the app can't tell the difference between that and a real duplicate,
// so it silently treats the whole creation as having "not resolved" rather
// than surfacing the real cause.
//
// This walks every collection that has this shape of migration history and
// drops any unique index that ISN'T scoped by `owner` as its first key —
// the current schema's own owner-scoped indexes are left alone; only the
// stale, pre-multi-tenancy ones go.
//
// Usage:
//   node scripts/fixCategoryGroupIndex.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const buildMongoUri = require('../config/mongoUri');

const COLLECTIONS = ['categorygroups', 'payees', 'categories', 'categorybudgets', 'tags'];

async function run() {
    await mongoose.connect(buildMongoUri());

    let droppedAny = false;
    for (const name of COLLECTIONS) {
        const collection = mongoose.connection.collection(name);
        const indexes = await collection.indexes();

        for (const idx of indexes) {
            if (idx.name === '_id_' || !idx.unique) continue;
            const firstKey = Object.keys(idx.key)[0];
            if (firstKey === 'owner') continue; // current, correct index — leave it

            console.log(`${name}: dropping stale index "${idx.name}" (key: ${JSON.stringify(idx.key)})`);
            await collection.dropIndex(idx.name);
            droppedAny = true;
        }
    }

    if (!droppedAny) {
        console.log('No stale non-owner-scoped unique indexes found — nothing to do.');
    } else {
        console.log('\nRestart the app so Mongoose builds the correct owner-scoped indexes.');
    }
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
