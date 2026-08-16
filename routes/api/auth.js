const express = require('express');
const router = express.Router();
const authController = require('../../controllers/authController');
const { loginLimiter, signupLimiter } = require('../../middleware/rateLimit');
const { csrfTokenRoute } = require('../../middleware/csrf');
const { requireApiAuth } = require('../../middleware/auth');

router.get('/csrf-token', csrfTokenRoute);
router.post('/signup', signupLimiter, authController.signup);
router.post('/login', loginLimiter, authController.login);
router.post('/login-ldap', loginLimiter, authController.loginLdap);
router.get('/ldap-status', authController.ldapStatus);
router.get('/oidc-status', authController.oidcStatus);
router.post('/logout', authController.logout);
router.get('/me', authController.me);
router.get('/preferences', requireApiAuth, authController.getPreferences);
router.put('/preferences', requireApiAuth, authController.updatePreferences);

module.exports = router;
