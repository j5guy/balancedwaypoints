const mongoose = require('mongoose');

// One row per backup/restore attempt (services/backup/backupService.js) —
// operational history for the Admin > Backups page, not app data, so it's
// deliberately excluded from the dump/restore set itself (see
// COLLECTION_DENYLIST in backupService.js).
const backupRunSchema = new mongoose.Schema({
    action: { type: String, enum: ['backup', 'restore'], required: true },
    // 'site' = the whole database (Admin > Backups); 'user' = just one
    // person's own owner-scoped data (My Account > Backups).
    scope: { type: String, enum: ['site', 'user'], required: true },
    // Whose personal data this run covers — set only when scope: 'user'.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    trigger: { type: String, enum: ['manual', 'scheduled'], required: true },
    status: { type: String, enum: ['success', 'error'], required: true },
    destination: { type: String, default: null },
    file: { type: String, default: null },
    sizeBytes: { type: Number, default: null },
    error: { type: String, default: null },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: true },
    // Who clicked the button for a manual run — distinct from `user` above
    // (an admin could in principle trigger the site run; a personal run's
    // triggeredBy and user are normally the same person).
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
});

module.exports = mongoose.model('BackupRun', backupRunSchema);
