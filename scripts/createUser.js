// CLI bootstrap for a user account — useful before the web signup flow has
// run, or for recovering admin access. Not a replacement for /auth/signup,
// just a way in when nobody can reach it yet.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const buildMongoUri = require('../config/mongoUri');
const User = require('../models/user');

const args = process.argv.slice(2);
const email = args.find(a => !a.startsWith('--'));
const makeAdmin = args.includes('--admin');
const passwordIdx = args.indexOf('--password');
const password = passwordIdx !== -1 ? args[passwordIdx + 1] : null;

if (!email || !password) {
    console.error('Usage: node scripts/createUser.js <email> --password <password> [--admin]');
    process.exit(1);
}

async function run() {
    await mongoose.connect(buildMongoUri());

    const normalized = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalized });
    if (existing) {
        console.log(`User "${existing.email}" already exists.`);
        if (makeAdmin && !existing.isAdmin) {
            existing.isAdmin = true;
            await existing.save();
            console.log('Promoted to admin.');
        }
        await mongoose.disconnect();
        return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
        email: normalized,
        displayName: normalized.split('@')[0],
        isAdmin: makeAdmin,
        passwordHash
    });
    console.log(`Created user "${user.email}"${makeAdmin ? ' (admin)' : ''}.`);

    await mongoose.disconnect();
}

run().catch(err => {
    console.error(err.message);
    process.exit(1);
});
