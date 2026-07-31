const express = require('express');
const router = express.Router();
const controller = require('../../controllers/importController');
const { requireApiAuth } = require('../../middleware/auth');
const upload = require('../../config/upload');

router.use(requireApiAuth);

router.post('/preview', upload.single('file'), controller.preview);
router.post('/commit', controller.commit);

module.exports = router;
