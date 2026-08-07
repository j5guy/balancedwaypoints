const BackupRun = require('../../models/backupRun');

const create = (data) => BackupRun.create(data);
const listSite = (limit = 20) => BackupRun.find({ scope: 'site' }).sort({ startedAt: -1 }).limit(limit)
    .populate('triggeredBy', 'email displayName').lean();
const listForUser = (userId, limit = 20) => BackupRun.find({ scope: 'user', user: userId }).sort({ startedAt: -1 }).limit(limit).lean();

module.exports = { create, listSite, listForUser };
