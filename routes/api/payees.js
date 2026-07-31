const express = require('express');
const router = express.Router();
const payeesController = require('../../controllers/payeesController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

router.get('/', payeesController.list);
router.post('/', payeesController.create);
router.put('/:id', payeesController.update);
router.delete('/:id', payeesController.remove);

module.exports = router;
