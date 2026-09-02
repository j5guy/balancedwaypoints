const express = require('express');
const router = express.Router();
const licenseController = require('../controllers/licenseController');

router.get('/', licenseController.show);
router.get('/checkout', licenseController.checkout);

module.exports = router;
