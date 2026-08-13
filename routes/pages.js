const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const HOME_REDIRECTS = { accounts: '/accounts', dashboard: '/dashboard' };

router.get('/', (req, res) => {
    if (req.session.userId) return res.redirect(HOME_REDIRECTS[req.session.homeDashboard] || '/budget');
    res.render('index', { title: 'Welcome' });
});

router.get('/dashboard', requireAuth, (req, res) => {
    res.render('dashboard/index', { title: 'Dashboard' });
});

router.get('/budget', requireAuth, (req, res) => {
    res.render('budget/index', { title: 'Budget' });
});

router.get('/budget/categories/cleanup', requireAuth, (req, res) => {
    res.render('budget/categoriesCleanup', { title: 'Clean Up Categories' });
});

router.get('/accounts', requireAuth, (req, res) => {
    res.render('accounts/index', { title: 'Accounts' });
});

router.get('/accounts/:id', requireAuth, (req, res) => {
    res.render('accounts/show', { title: 'Register', accountId: req.params.id });
});

router.get('/payees', requireAuth, (req, res) => {
    res.render('payees/index', { title: 'Payees' });
});

router.get('/rules', requireAuth, (req, res) => {
    res.render('rules/index', { title: 'Rules' });
});

router.get('/schedules', requireAuth, (req, res) => {
    res.render('schedules/index', { title: 'Schedules' });
});

router.get('/imports', requireAuth, (req, res) => {
    res.render('imports/index', { title: 'Import' });
});

router.get('/reports', requireAuth, (req, res) => {
    res.render('reports/index', { title: 'Reports' });
});

router.get('/account', requireAuth, (req, res) => {
    res.render('account/index', { title: 'My Account' });
});

router.get('/account/general', requireAuth, (req, res) => {
    res.render('account/general', { title: 'General' });
});

router.get('/account/notifications', requireAuth, (req, res) => {
    res.render('account/notifications', { title: 'Email notifications' });
});

router.get('/account/mail-server', requireAuth, (req, res) => {
    res.render('account/mailServer', { title: 'Mail server' });
});

router.get('/account/api-access', requireAuth, (req, res) => {
    res.render('account/apiAccess', { title: 'API access' });
});

router.get('/account/appearance', requireAuth, (req, res) => {
    res.render('account/appearance', { title: 'Appearance' });
});

router.get('/account/backups', requireAuth, (req, res) => {
    res.render('account/backups', { title: 'Backups' });
});

router.get('/account/bank-sync', requireAuth, (req, res) => {
    res.render('account/bankSync', { title: 'Bank Sync' });
});

module.exports = router;
