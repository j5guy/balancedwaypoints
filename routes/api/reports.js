const express = require('express');
const router = express.Router();
const controller = require('../../controllers/reportsController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

router.get('/spending-by-category', controller.spending);
router.get('/income-vs-expense', controller.incomeExpense);
router.get('/net-worth', controller.netWorthReport);

module.exports = router;
