require('dotenv').config();
const mongoose = require('mongoose');
const buildMongoUri = require('./mongoUri');

// One-time repair for accounts that saved preferences.dashboard.widgets
// back when it was a plain array of type strings (e.g. "summary"), before
// it became an array of {id, type, accountId} instances (see
// models/user.js). Those stale string entries load fine (Mongoose hydration
// is lenient), but ANY save() on the document — including just the
// lastLoginAt touch every login does, local or LDAP — re-validates the
// whole document and fails, blocking login entirely for that account.
//
// Goes through mongoose.connection.collection('users') — the raw MongoDB
// driver, bypassing Mongoose's schema casting/validation — rather than
// loading each User through the model and re-saving it: a Mongoose-level
// fix (e.g. a pre-validate hook) would depend on exactly how Mongoose's
// cast-then-defer-to-validate internals represent an already-invalid path
// in memory, which isn't a stable enough assumption to build a real fix on.
// A raw update just rewrites the stored BSON directly, so it's correct
// regardless of that. $type: 'string' against an array field matches any
// document where at least one element of that array is a string — the
// signature of the old format.
async function repairLegacyDashboardWidgets() {
    const users = mongoose.connection.collection('users');
    const affected = await users.find(
        { 'preferences.dashboard.widgets': { $type: 'string' } },
        { projection: { 'preferences.dashboard.widgets': 1 } }
    ).toArray();

    for (const user of affected) {
        const widgets = (user.preferences.dashboard.widgets || []).map((w) => (
            typeof w === 'string' ? { id: w, type: w, accountId: null } : w
        ));
        await users.updateOne({ _id: user._id }, { $set: { 'preferences.dashboard.widgets': widgets } });
    }

    if (affected.length > 0) {
        console.log(`✅ Repaired legacy preferences.dashboard.widgets on ${affected.length} account(s)`);
    }
}

const mongooseConnect = async () => {
    try {
        await mongoose.connect(buildMongoUri());
        console.log('✅ MongoDB Connected Using Mongoose');
    } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
    }

    // Best-effort — a problem here shouldn't take the whole app down, since
    // a failed repair just leaves the affected account(s) in the same
    // already-broken state they were in before this ran, not a new one.
    try {
        await repairLegacyDashboardWidgets();
    } catch (err) {
        console.error(`⚠️  Legacy dashboard widgets repair failed: ${err.message}`);
    }
};

module.exports = mongooseConnect;
