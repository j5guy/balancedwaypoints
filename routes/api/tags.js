const express = require('express');
const router = express.Router();
const tagsController = require('../../controllers/tagsController');
const { requireApiAuth, requireApiAdmin } = require('../../middleware/auth');

router.use(requireApiAuth);

router.get('/', tagsController.list);
// Creation is open to any authenticated user (typeahead "create if missing"
// when tagging a transaction) — rename/delete stay admin-only for cleanup.
router.post('/', tagsController.create);
router.put('/:id', requireApiAdmin, tagsController.update);
router.delete('/:id', requireApiAdmin, tagsController.remove);

module.exports = router;
