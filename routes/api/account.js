const express = require('express');
const router = express.Router();
const accountController = require('../../controllers/accountController');
const { requireApiAuth } = require('../../middleware/auth');
const backupUpload = require('../../config/backupUpload');

router.use(requireApiAuth);

router.get('/', accountController.getAccount);
router.put('/smtp', accountController.updateSmtp);
router.delete('/smtp', accountController.clearSmtp);
router.post('/smtp/test', accountController.testSmtp);

router.post('/api-key', accountController.generateApiKeyForAccount);
router.delete('/api-key', accountController.revokeApiKeyForAccount);

// Personal backups (just this user's own data) — see controllers/accountController.js.
router.get('/settings/backup', accountController.getBackupSettings);
router.put('/settings/backup', accountController.updateBackupSettings);
router.post('/settings/backup/check', accountController.checkBackupDestination);

router.get('/backup/runs', accountController.listBackupRuns);
router.get('/backup/files', accountController.listBackupFiles);
router.get('/backup/files/:name/download', accountController.downloadBackupFile);
router.delete('/backup/files/:name', accountController.deleteBackupFile);
router.post('/backup/run', accountController.runBackupNow);
router.post('/backup/restore-upload', backupUpload.single('file'), accountController.restoreFromUpload);
router.post('/backup/files/:name/restore', accountController.restoreFromFile);

module.exports = router;
