const bcrypt = require('bcrypt');
const usersDb = require('../database/users');
const logger = require('../../utils/logger');

// Creates a persistent local admin account from ADMIN_EMAIL/ADMIN_PASSWORD,
// or no-ops if either is unset or an admin already exists. Only meaningful
// in demo mode: a normal install's admin comes from the first real signup
// (see controllers/authController.js's signup), but a demo box's database
// gets dropped nightly (services/demo/reset.js), which would otherwise
// leave nobody able to log back in as an operator. Assumes mongoose is
// already connected — callers own that lifecycle.
async function createInitialAdmin() {
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        logger.info('ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin bootstrap.');
        return;
    }

    const email = ADMIN_EMAIL.toLowerCase().trim();
    const existing = await usersDb.findByEmail(email);
    if (existing) {
        if (!existing.isAdmin) await usersDb.update(existing._id, { isAdmin: true });
        return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await usersDb.create({
        email,
        displayName: 'Admin',
        isAdmin: true,
        authSource: 'local',
        passwordHash,
        notifyEmail: email
    });

    logger.info(`Bootstrapped admin user "${email}".`);
}

module.exports = createInitialAdmin;
