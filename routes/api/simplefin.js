const express = require('express');
const router = express.Router();
const controller = require('../../controllers/simplefinController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

router.get('/connections', controller.list);
router.post('/connections', controller.create);
router.delete('/connections/:id', controller.remove);

router.get('/connections/:id/remote-accounts', controller.remoteAccountsFor);
router.post('/connections/:id/link', controller.link);
router.post('/connections/:id/sync', controller.syncNow);

module.exports = router;
