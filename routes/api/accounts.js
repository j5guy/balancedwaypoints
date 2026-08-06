const express = require('express');
const router = express.Router();
const accountsController = require('../../controllers/accountsController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

// Before '/:id' — otherwise Express would try to treat "shared-with-me" as
// an account id.
router.get('/shared-with-me', accountsController.sharedWithMe);

router.get('/', accountsController.list);
router.get('/:id', accountsController.get);
router.post('/', accountsController.create);
router.put('/:id', accountsController.update);
router.delete('/:id', accountsController.remove);
router.delete('/:id/force', accountsController.forceRemove);

router.get('/:id/shares', accountsController.listShares);
router.post('/:id/shares', accountsController.createShare);
router.put('/:id/shares/:shareId', accountsController.updateShare);
router.delete('/:id/shares/:shareId', accountsController.removeShare);

module.exports = router;
