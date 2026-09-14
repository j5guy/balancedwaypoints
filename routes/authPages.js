const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('auth/login', { title: 'Log in', redirect: req.query.redirect || '/', error: req.query.error || null });
});

router.get('/signup', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('auth/signup', { title: 'Sign up' });
});

module.exports = router;
