const express = require('express');
const router = express.Router();
const authController = require('../../controllers/authController');
const { loginLimiter, signupLimiter } = require('../../middleware/rateLimit');
const { csrfTokenRoute } = require('../../middleware/csrf');

router.get('/csrf-token', csrfTokenRoute);
router.post('/signup', signupLimiter, authController.signup);
router.post('/login', loginLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', authController.me);

module.exports = router;
