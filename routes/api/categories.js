const express = require('express');
const router = express.Router();
const controller = require('../../controllers/categoriesController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

router.get('/', controller.list);
router.get('/cleanup-report', controller.cleanupReport);
router.post('/', controller.create);
router.post('/merge', controller.merge);
router.post('/bulk-delete', controller.bulkDelete);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
