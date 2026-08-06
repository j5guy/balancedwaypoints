// One-time repair for the categoryGroups uniqueness constraint: it used to
// be { owner, name } only, so an income group and an expense group couldn't
// share a name (blocked with a false "already exists" error even though the
// conflicting group lived in a different section of the budget page). The
// schema (models/categoryGroup.js) now scopes it to { owner, name,
// isIncome }; this drops the old index so Mongoose's autoIndex can build the
// new one on next app start.
//
// Usage:
//   node scripts/fixCategoryGroupIndex.js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const buildMongoUri = require('../config/mongoUri');

async function run() {
    await mongoose.connect(buildMongoUri());
    const collection = mongoose.connection.collection('categorygroups');

    const indexes = await collection.indexes();
    const stale = indexes.find(idx => JSON.stringify(idx.key) === JSON.stringify({ owner: 1, name: 1 }));

    if (!stale) {
        console.log('No stale owner+name index found — nothing to do.');
    } else {
        await collection.dropIndex(stale.name);
        console.log(`Dropped stale index "${stale.name}".`);
    }

    console.log('Restart the app so Mongoose builds the new owner+name+isIncome index.');
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
