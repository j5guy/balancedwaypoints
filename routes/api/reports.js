const express = require('express');
const router = express.Router();
const controller = require('../../controllers/reportsController');
const { requireApiKeyOrAuth } = require('../../middleware/auth');

router.use(requireApiKeyOrAuth);

router.get('/spending-by-category', controller.spending);
router.get('/income-vs-expense', controller.incomeExpense);
router.get('/net-worth', controller.netWorthReport);
router.get('/summary', controller.summaryReport);
router.get('/forecast', controller.forecastReport);

module.exports = router;
