const express = require('express');
const router = express.Router();
const accountsController = require('../../controllers/accountsController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

// Not nested under /accounts/:id — this isn't scoped to one account, it's
// "which owners' data can I act on at all" (see accountsController.js's
// actingOwners / services/database/accountShares.js's listActingOwners).
router.get('/acting-owners', accountsController.actingOwners);

module.exports = router;
