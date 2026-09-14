const multer = require('multer');

// Cert/key uploads are tiny PEM text files — held in memory only (never
// written to disk under multer's own name) and validated/persisted
// explicitly by controllers/settingsController.js via
// services/settings/tlsCerts.js.
module.exports = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 64 * 1024 }
});
