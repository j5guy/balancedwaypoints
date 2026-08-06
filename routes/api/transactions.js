const express = require('express');
const router = express.Router();
const controller = require('../../controllers/transactionsController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

router.get('/', controller.list);
router.get('/:id', controller.get);
router.post('/', controller.create);
router.post('/transfer', controller.createTransfer);
router.post('/:id/convert-to-transfer', controller.convertToTransfer);
router.post('/reorder', controller.reorder);
router.post('/preview-rules', controller.previewRules);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
