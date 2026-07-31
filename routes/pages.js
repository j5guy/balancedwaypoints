const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/budget');
    res.render('index', { title: 'Welcome' });
});

router.get('/budget', requireAuth, (req, res) => {
    res.render('budget/index', { title: 'Budget' });
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

module.exports = router;
