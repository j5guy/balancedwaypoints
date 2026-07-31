const multer = require('multer');

// Bank export files (CSV/OFX/QFX) are parsed in-memory and never written to
// disk — there's nothing here worth persisting once the import is committed.
module.exports = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});
