const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');

router.get('/', requireAdmin, (req, res) => {
    res.render('admin/index', { title: 'Admin' });
});

router.get('/users', requireAdmin, (req, res) => {
    res.render('admin/users', { title: 'Users' });
});

module.exports = router;
