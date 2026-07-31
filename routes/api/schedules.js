const express = require('express');
const router = express.Router();
const controller = require('../../controllers/schedulesController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

router.get('/', controller.list);
router.get('/upcoming', controller.upcoming);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);
router.put('/:id/occurrence', controller.setOccurrenceOverride);
router.post('/:id/post', controller.postOccurrence);

module.exports = router;
