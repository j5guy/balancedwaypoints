const express = require('express');
const router = express.Router();
const tagsController = require('../../controllers/tagsController');
const { requireApiAuth } = require('../../middleware/auth');

router.use(requireApiAuth);

// Tags are per-user data now (see models/tag.js's owner field) — no longer
// a shared household resource, so rename/delete no longer need the
// admin-only gate they used to (that was for cleaning up everyone's shared
// tags; each user's own tags are theirs to manage freely).
router.get('/', tagsController.list);
router.post('/', tagsController.create);
router.put('/:id', tagsController.update);
router.delete('/:id', tagsController.remove);

module.exports = router;
