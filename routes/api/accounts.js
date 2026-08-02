const express = require('express');
const router = express.Router();
const accountsController = require('../../controllers/accountsController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

router.get('/', accountsController.list);
router.get('/:id', accountsController.get);
router.post('/', accountsController.create);
router.put('/:id', accountsController.update);
router.delete('/:id', accountsController.remove);
router.delete('/:id/force', accountsController.forceRemove);

module.exports = router;
