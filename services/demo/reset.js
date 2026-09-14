// Nightly reset for a demo deployment: a full DB wipe rather than trying to
// selectively delete just demo users' data, so "reset everything" actually
// means everything — no state can accumulate anywhere by accident. Runs
// against the live mongoose connection — dropDatabase() just empties every
// collection; mongoose recreates them lazily on next write, so nothing
// needs to be reconnected or re-registered afterward. Mirrors
// loadout/services/demo/reset.js.
const mongoose = require('mongoose');
const logger = require('../../utils/logger');
const createInitialAdmin = require('../bootstrap/createInitialAdmin');
const License = require('../../models/license');

async function resetDemoData() {
    logger.info('Demo reset: dropping database…');

    // models/license.js is explicit that its singleton doc (instanceId +
    // activated key) MUST survive a container recreate so the install
    // doesn't lose its license — a demo box's nightly dropDatabase() is no
    // different in that respect. Snapshot it here and restore it after,
    // rather than let it get wiped and re-gated like everything else.
    const licenseSnapshot = await License.findById('singleton').lean();

    await mongoose.connection.dropDatabase();

    if (licenseSnapshot) await License.create(licenseSnapshot);

    // Recreates the persistent operator login from ADMIN_EMAIL/ADMIN_PASSWORD
    // (see services/bootstrap/createInitialAdmin.js) — without this, the
    // demo box would come back up every morning with no way for whoever
    // runs it to log back in. Demo visitors' own accounts/data are NOT
    // reseeded here; each one is generated fresh at /demo signup time (see
    // services/demo/seedDemoUserData.js), so there's nothing shared to
    // reseed after a wipe.
    await createInitialAdmin();

    logger.info('Demo reset: complete.');
}

module.exports = resetDemoData;
