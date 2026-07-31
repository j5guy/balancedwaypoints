const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/adminController');
const { requireApiAdmin } = require('../../middleware/auth');

router.use(requireApiAdmin);

router.get('/users', adminController.listUsers);
router.put('/users/:id/admin', adminController.setAdmin);
router.delete('/users/:id', adminController.removeUser);

module.exports = router;
