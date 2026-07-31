const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('auth/login', { title: 'Log in', redirect: req.query.redirect || '/' });
});

router.get('/signup', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('auth/signup', { title: 'Sign up' });
});

module.exports = router;
