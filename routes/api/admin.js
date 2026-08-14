const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/adminController');
const { requireApiAdmin } = require('../../middleware/auth');
const backupUpload = require('../../config/backupUpload');

router.use(requireApiAdmin);

router.get('/users', adminController.listUsers);
router.put('/users/:id', adminController.updateUser);
router.put('/users/:id/admin', adminController.setAdmin);
router.delete('/users/:id', adminController.removeUser);

router.get('/settings/ldap', adminController.getLdapSettings);
router.put('/settings/ldap', adminController.updateLdapSettings);
router.delete('/settings/ldap', adminController.resetLdapSettings);
router.post('/settings/ldap/test', adminController.testLdapSettings);

router.get('/settings/oidc', adminController.getOidcSettings);
router.put('/settings/oidc', adminController.updateOidcSettings);
router.delete('/settings/oidc', adminController.resetOidcSettings);

router.get('/settings/backup', adminController.getBackupSettings);
router.put('/settings/backup', adminController.updateBackupSettings);
router.post('/settings/backup/check', adminController.checkBackupDestination);

router.get('/backup/runs', adminController.listBackupRuns);
router.get('/backup/files', adminController.listBackupFiles);
router.get('/backup/files/:name/download', adminController.downloadBackupFile);
router.delete('/backup/files/:name', adminController.deleteBackupFile);
router.post('/backup/run', adminController.runBackupNow);
router.post('/backup/restore-upload', backupUpload.single('file'), adminController.restoreFromUpload);
router.post('/backup/files/:name/restore', adminController.restoreFromFile);

module.exports = router;
