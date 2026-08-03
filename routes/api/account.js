const express = require('express');
const router = express.Router();
const accountController = require('../../controllers/accountController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

router.get('/', accountController.getAccount);
router.put('/smtp', accountController.updateSmtp);
router.delete('/smtp', accountController.clearSmtp);
router.post('/smtp/test', accountController.testSmtp);

router.post('/api-key', accountController.generateApiKeyForAccount);
router.delete('/api-key', accountController.revokeApiKeyForAccount);

module.exports = router;
