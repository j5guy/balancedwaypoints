const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const licenseDb = require('../services/database/license');
const gate = require('../services/licensing/gate');
const logExportSettingsStore = require('../services/settings/store');
const tlsCerts = require('../services/settings/tlsCerts');
const uploadCert = require('../config/uploadCert');
const adminController = require('../controllers/adminController');

router.get('/', requireAdmin, (req, res) => {
    res.render('admin/index', { title: 'Admin' });
});

router.get('/license', requireAdmin, async (req, res) => {
    const cached = await licenseDb.getCachedLicense();
    res.render('admin/license', {
        title: 'License',
        license: cached,
        active: gate.isLicenseActive(cached),
        error: req.query.error || null
    });
});

router.get('/users', requireAdmin, (req, res) => {
    res.render('admin/users', { title: 'Users' });
});

router.get('/ldap', requireAdmin, (req, res) => {
    res.render('admin/ldap', { title: 'LDAP' });
});

router.get('/backups', requireAdmin, (req, res) => {
    res.render('admin/backups', { title: 'Backups' });
});

router.get('/settings', requireAdmin, (req, res) => {
    res.render('admin/settings', {
        title: 'Settings',
        tlsEnabled: logExportSettingsStore.get().tls.enabled,
        certInfo: tlsCerts.info(),
        error: req.query.error || null
    });
});

router.post('/settings/tls', requireAdmin, uploadCert.fields([{ name: 'cert', maxCount: 1 }, { name: 'key', maxCount: 1 }]), adminController.enableTls);
router.post('/settings/tls/disable', requireAdmin, adminController.disableTls);

module.exports = router;
