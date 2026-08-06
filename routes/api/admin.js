const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/adminController');
const { requireApiAdmin } = require('../../middleware/auth');

router.use(requireApiAdmin);

router.get('/users', adminController.listUsers);
router.put('/users/:id', adminController.updateUser);
router.put('/users/:id/admin', adminController.setAdmin);
router.delete('/users/:id', adminController.removeUser);

router.get('/settings/ldap', adminController.getLdapSettings);
router.put('/settings/ldap', adminController.updateLdapSettings);
router.delete('/settings/ldap', adminController.resetLdapSettings);
router.post('/settings/ldap/test', adminController.testLdapSettings);

module.exports = router;
