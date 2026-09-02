const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const licenseDb = require('../services/database/license');
const gate = require('../services/licensing/gate');

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

router.get('/oidc', requireAdmin, (req, res) => {
    res.render('admin/oidc', { title: 'OIDC' });
});

router.get('/backups', requireAdmin, (req, res) => {
    res.render('admin/backups', { title: 'Backups' });
});

module.exports = router;
