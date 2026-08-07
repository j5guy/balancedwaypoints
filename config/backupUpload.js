const multer = require('multer');

// Restore uploads (a gzipped full-database dump — see
// services/backup/backupService.js) are small relative to bank export
// files but not bounded the same way, so this gets its own, larger limit
// rather than reusing config/upload.js's 10MB.
module.exports = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 250 * 1024 * 1024 }
});
