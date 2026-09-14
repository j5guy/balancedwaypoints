const express = require('express');
const router = express.Router();
const { showLanding, createDemoAccount } = require('../controllers/demoController');
const demoRateLimit = require('../middleware/demoRateLimit');

// Only ever mounted when config.demoMode is on — see server.js.
router.get('/', showLanding);
router.post('/start', demoRateLimit, createDemoAccount);

module.exports = router;
