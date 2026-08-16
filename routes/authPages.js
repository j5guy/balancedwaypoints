const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { loginLimiter } = require('../middleware/rateLimit');

router.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('auth/login', { title: 'Log in', redirect: req.query.redirect || '/', error: req.query.error || null });
});

router.get('/signup', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('auth/signup', { title: 'Sign up' });
});

// OIDC needs real page-level GET routes (not /api) since it's a browser
// redirect round-trip to the IdP and back, not a fetch() call — see
// controllers/authController.js's oidcStart/oidcCallback.
router.get('/oidc/start', loginLimiter, authController.oidcStart);
router.get('/oidc/callback', authController.oidcCallback);

module.exports = router;
