// Thin CLI wrapper around services/bootstrap/createInitialAdmin.js, run by
// docker-entrypoint.sh on every boot — connects, bootstraps (a no-op once an
// admin already exists or ADMIN_EMAIL/ADMIN_PASSWORD aren't set), disconnects.
require('dotenv').config();
const mongoose = require('mongoose');
const buildMongoUri = require('../config/mongoUri');
const createInitialAdmin = require('../services/bootstrap/createInitialAdmin');

async function run() {
    await mongoose.connect(buildMongoUri());
    await createInitialAdmin();
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
