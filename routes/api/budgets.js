const express = require('express');
const router = express.Router();
const controller = require('../../controllers/budgetsController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

router.get('/:month', controller.getMonth);
router.put('/:month/:categoryId', controller.assign);

module.exports = router;
