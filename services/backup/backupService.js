// Full-database (or full-personal-data) backup/restore, entirely in Node —
// no mongodump/mongorestore binary required, since this app's Docker image
// deliberately stays minimal (see Dockerfile) and some deployments run on
// ARM hardware where installing MongoDB's tooling package is its own
// headache (see docker-compose.mongo.yml's MONGO_IMAGE note). A dump is
// just every relevant document, EJSON-encoded (so ObjectId/Date/etc.
// round-trip exactly) and gzipped into one file.
//
// Two scopes share all of this code, distinguished by a `ctx` of
// `{ scope: 'site' }` (the whole database — Admin > Backups) or
// `{ scope: 'user', userId }` (just one person's own owner-scoped documents
// — My Account > Backups). Both scopes' files can live in the same
// destination directory: filenames are namespaced by scope (and by userId
// for personal ones), and every listing/retention/restore operation only
// ever matches its own scope's pattern, so they never interfere with each
// other or with unrelated files.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const mongoose = require('mongoose');
const settingsDb = require('../database/settings');
const usersDb = require('../database/users');
const backupRunsDb = require('../database/backupRuns');
const logger = require('../../utils/logger');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DEFAULT_DIR = path.join(global.appRoot, 'backups');
const FILE_PREFIX = 'balancedwaypoints-backup-';
const TIMESTAMP = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z';
const SITE_FILE_PATTERN = new RegExp(`^${FILE_PREFIX}site-${TIMESTAMP}\\.json\\.gz$`);
// ObjectId is always 24 lowercase hex chars — validated before being
// interpolated into a RegExp used for file delete/restore/list matching.
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/;
const userFilePattern = (userId) => {
    if (!OBJECT_ID_PATTERN.test(String(userId))) throw new Error('Invalid user id');
    return new RegExp(`^${FILE_PREFIX}user-${userId}-${TIMESTAMP}\\.json\\.gz$`);
};

// Operational history, not app/user data — see models/backupRun.js.
// Excluded from every dump (no point backing up "here's when past backups
// ran") and from every restore sweep (a restore shouldn't erase the log of
// itself).
const EXCLUDED_MODELS = new Set(['BackupRun']);

function patternForScope(ctx) {
    return ctx.scope === 'user' ? userFilePattern(ctx.userId) : SITE_FILE_PATTERN;
}

function filenameForScope(ctx, date) {
    const ts = date.toISOString().replace(/[:.]/g, '-');
    return ctx.scope === 'user'
        ? `${FILE_PREFIX}user-${ctx.userId}-${ts}.json.gz`
        : `${FILE_PREFIX}site-${ts}.json.gz`;
}

// mongoose.mongo is the underlying `mongodb` driver, which re-exports the
// `bson` package's EJSON for exactly this purpose. Falls back to requiring
// `bson` directly (a transitive dependency of `mongodb`, so always present)
// in case that re-export ever moves.
function ejson() {
    const bson = (mongoose.mongo && mongoose.mongo.BSON) || require('bson');
    return bson.EJSON;
}

function registeredCollections() {
    const map = new Map();
    for (const modelName of mongoose.modelNames()) {
        if (EXCLUDED_MODELS.has(modelName)) continue;
        const model = mongoose.model(modelName);
        map.set(model.collection.name, model.collection);
    }
    return map;
}

// Just the collections that can be attributed to one person (everything
// with an `owner` field) — Users and Settings are deliberately excluded
// from a personal backup even though they're not in EXCLUDED_MODELS, since
// neither belongs to a single owner.
function ownerScopedCollections() {
    const map = new Map();
    for (const modelName of mongoose.modelNames()) {
        if (EXCLUDED_MODELS.has(modelName)) continue;
        const model = mongoose.model(modelName);
        if (!model.schema.path('owner')) continue;
        map.set(model.collection.name, model.collection);
    }
    return map;
}

async function resolveDestination(ctx) {
    if (ctx.scope === 'user') {
        const user = await usersDb.findById(ctx.userId);
        return (user && user.backup && user.backup.destination) || DEFAULT_DIR;
    }
    const settings = await settingsDb.getBackupSettings();
    return settings.destination || DEFAULT_DIR;
}

async function resolveRetentionCount(ctx) {
    if (ctx.scope === 'user') {
        const user = await usersDb.findById(ctx.userId);
        return (user && user.backup && user.backup.retentionCount) || 7;
    }
    const settings = await settingsDb.getBackupSettings();
    return settings.retentionCount;
}

// Ensures the *default* directory exists (harmless — it's already baked
// into the image/volume, see Dockerfile). Never called for an admin- or
// user-chosen custom destination: auto-creating a missing custom path would
// silently turn "the NAS mount isn't there" into "here's an empty local
// directory that looks fine," which defeats the point of checkDestination
// below.
async function ensureDefaultDir() {
    await fs.promises.mkdir(DEFAULT_DIR, { recursive: true });
}

// Existence + directory-ness + an actual write probe (not just a
// permissions check) — this is what catches a disconnected network mount,
// a read-only filesystem, or a typo'd path before a scheduled run ever
// gets there.
async function checkDestination(destPath) {
    let stat;
    try {
        stat = await fs.promises.stat(destPath);
    } catch (err) {
        return {
            ok: false,
            message: `"${destPath}" doesn't exist or isn't reachable (${err.code}). If this is meant to be a network location, make sure it's mounted into the app container at exactly this path.`
        };
    }
    if (!stat.isDirectory()) {
        return { ok: false, message: `"${destPath}" exists but isn't a directory.` };
    }

    const probe = path.join(destPath, `.bw-write-test-${crypto.randomBytes(6).toString('hex')}`);
    try {
        await fs.promises.writeFile(probe, 'ok');
        await fs.promises.unlink(probe);
    } catch (err) {
        return { ok: false, message: `"${destPath}" isn't writable (${err.code}).` };
    }
    return { ok: true, message: 'Location is available and writable.' };
}

async function dumpDatabase(ctx) {
    const EJSON = ejson();
    const collections = {};

    if (ctx.scope === 'user') {
        const ownerId = new mongoose.Types.ObjectId(ctx.userId);
        for (const [collectionName, collection] of ownerScopedCollections()) {
            const docs = await collection.find({ owner: ownerId }).toArray();
            collections[collectionName] = EJSON.serialize(docs);
        }
    } else {
        for (const [collectionName, collection] of registeredCollections()) {
            const docs = await collection.find({}).toArray();
            collections[collectionName] = EJSON.serialize(docs);
        }
    }

    return {
        meta: {
            app: 'balancedwaypoints',
            scope: ctx.scope,
            userId: ctx.scope === 'user' ? String(ctx.userId) : null,
            dumpedAt: new Date().toISOString()
        },
        collections
    };
}

async function applyRetention(destPath, pattern, retentionCount) {
    const entries = await fs.promises.readdir(destPath);
    const files = entries.filter((name) => pattern.test(name)).sort().reverse();
    for (const name of files.slice(retentionCount)) {
        await fs.promises.unlink(path.join(destPath, name)).catch((err) => {
            logger.error(`Backup retention: failed to remove ${name}: ${err.message}`);
        });
    }
}

async function runBackup(ctx, { trigger, triggeredBy = null }) {
    const startedAt = new Date();
    const destPath = await resolveDestination(ctx);
    const isDefaultDestination = destPath === DEFAULT_DIR;
    if (isDefaultDestination) await ensureDefaultDir();

    const recordFields = { action: 'backup', scope: ctx.scope, user: ctx.scope === 'user' ? ctx.userId : null, trigger, triggeredBy, destination: destPath };

    const check = await checkDestination(destPath);
    if (!check.ok) {
        const run = await backupRunsDb.create({ ...recordFields, status: 'error', error: check.message, startedAt, finishedAt: new Date() });
        return { status: 'error', error: check.message, run };
    }

    try {
        const dump = await dumpDatabase(ctx);
        const gzipped = await gzip(Buffer.from(JSON.stringify(dump), 'utf8'));
        const filename = filenameForScope(ctx, startedAt);
        await fs.promises.writeFile(path.join(destPath, filename), gzipped);

        const retentionCount = await resolveRetentionCount(ctx);
        await applyRetention(destPath, patternForScope(ctx), retentionCount);

        const run = await backupRunsDb.create({
            ...recordFields, status: 'success', file: filename, sizeBytes: gzipped.length, startedAt, finishedAt: new Date()
        });
        return { status: 'success', file: filename, sizeBytes: gzipped.length, destination: destPath, run };
    } catch (err) {
        const run = await backupRunsDb.create({ ...recordFields, status: 'error', error: err.message, startedAt, finishedAt: new Date() });
        return { status: 'error', error: err.message, run };
    }
}

async function listBackupFiles(ctx) {
    const destPath = await resolveDestination(ctx);
    const pattern = patternForScope(ctx);
    let entries;
    try {
        entries = await fs.promises.readdir(destPath, { withFileTypes: true });
    } catch (err) {
        return { destination: destPath, files: [], error: err.message };
    }
    const files = [];
    for (const entry of entries) {
        if (!entry.isFile() || !pattern.test(entry.name)) continue;
        const stat = await fs.promises.stat(path.join(destPath, entry.name));
        files.push({ name: entry.name, sizeBytes: stat.size, modifiedAt: stat.mtime });
    }
    files.sort((a, b) => b.name.localeCompare(a.name));
    return { destination: destPath, files };
}

async function deleteBackupFile(ctx, name) {
    if (!patternForScope(ctx).test(name)) throw new Error('Invalid backup filename');
    const destPath = await resolveDestination(ctx);
    await fs.promises.unlink(path.join(destPath, name));
}

// Wipes the dumped documents and re-inserts from the backup, raw against
// the driver (collection.insertMany, not a Mongoose model) so a document
// that predates a schema/validator added since the backup was taken still
// restores byte-for-byte instead of failing validation — same rationale as
// config/mongoose.js's repairLegacyDashboardWidgets. Only collections
// belonging to a currently-registered model are touched, so a corrupted or
// hand-edited backup file can't be used to write into arbitrary
// collections. For a user-scope restore, only that user's own documents
// within each collection are wiped/replaced — everyone else's rows in the
// same shared collection are untouched.
async function restoreDump(ctx, dump, { trigger, triggeredBy = null, destination = null }) {
    const startedAt = new Date();
    const recordFields = { action: 'restore', scope: ctx.scope, user: ctx.scope === 'user' ? ctx.userId : null, trigger, triggeredBy, destination };

    async function fail(message) {
        const run = await backupRunsDb.create({ ...recordFields, status: 'error', error: message, startedAt, finishedAt: new Date() });
        return { status: 'error', error: message, run };
    }

    if (!dump || typeof dump !== 'object' || !dump.collections || typeof dump.collections !== 'object') {
        return fail('Not a recognizable Balanced Waypoints backup file');
    }

    const declaredScope = dump.meta && dump.meta.scope;
    if (ctx.scope === 'user') {
        if (declaredScope !== 'user' || String(dump.meta.userId) !== String(ctx.userId)) {
            return fail('This backup file does not belong to your account');
        }
    } else if (declaredScope === 'user') {
        return fail('This is a personal (per-user) backup file, not a full-site backup');
    }

    const EJSON = ejson();
    const targetCollections = ctx.scope === 'user' ? ownerScopedCollections() : registeredCollections();
    const ownerFilter = ctx.scope === 'user' ? { owner: new mongoose.Types.ObjectId(ctx.userId) } : {};

    try {
        let restoredCollections = 0;
        for (const [collectionName, rawDocs] of Object.entries(dump.collections)) {
            const collection = targetCollections.get(collectionName);
            if (!collection || !Array.isArray(rawDocs)) continue;

            const docs = EJSON.deserialize(rawDocs);
            await collection.deleteMany(ownerFilter);
            // Batched so one giant insertMany can't blow past MongoDB's
            // 16MB-per-command BSON limit on a large register.
            for (let i = 0; i < docs.length; i += 500) {
                const batch = docs.slice(i, i + 500);
                if (batch.length > 0) await collection.insertMany(batch, { ordered: false });
            }
            restoredCollections++;
        }

        const run = await backupRunsDb.create({ ...recordFields, status: 'success', startedAt, finishedAt: new Date() });
        return { status: 'success', restoredCollections, run };
    } catch (err) {
        return fail(err.message);
    }
}

async function restoreFromBuffer(ctx, gzippedBuffer, opts) {
    let dump = null;
    try {
        const json = await gunzip(gzippedBuffer);
        dump = JSON.parse(json.toString('utf8'));
    } catch (err) {
        // Falls through to restoreDump(ctx, null, ...), which reports the
        // standard "not a recognizable backup file" error and still records
        // the attempt.
    }
    return restoreDump(ctx, dump, opts);
}

async function restoreFromFile(ctx, name, opts) {
    if (!patternForScope(ctx).test(name)) throw new Error('Invalid backup filename');
    const destPath = await resolveDestination(ctx);
    const buffer = await fs.promises.readFile(path.join(destPath, name));
    return restoreFromBuffer(ctx, buffer, { ...opts, destination: destPath });
}

// Shared request-body validation for both Admin > Backups (site) and My
// Account > Backups (personal) settings forms.
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
function parseBackupSettingsInput(body) {
    const destination = String((body || {}).destination || '').trim();
    const frequency = String((body || {}).frequency || 'disabled');
    const time = String((body || {}).time || '03:00').trim();
    const rawDayOfWeek = (body || {}).dayOfWeek;
    const dayOfWeek = Number.isInteger(rawDayOfWeek) ? rawDayOfWeek : parseInt(rawDayOfWeek, 10);
    const rawRetention = (body || {}).retentionCount;
    const retentionCount = Number.isInteger(rawRetention) ? rawRetention : parseInt(rawRetention, 10);

    if (!['disabled', 'daily', 'weekly'].includes(frequency)) return { error: 'Invalid frequency' };
    if (!TIME_PATTERN.test(time)) return { error: 'Time must be in HH:MM (24h) format' };
    if (frequency === 'weekly' && !(dayOfWeek >= 0 && dayOfWeek <= 6)) return { error: 'dayOfWeek must be 0-6' };
    if (!(retentionCount >= 1)) return { error: 'retentionCount must be at least 1' };

    return {
        destination: destination || null,
        frequency,
        time,
        dayOfWeek: Number.isInteger(dayOfWeek) ? dayOfWeek : 0,
        retentionCount
    };
}

module.exports = {
    DEFAULT_DIR, OBJECT_ID_PATTERN,
    patternForScope,
    resolveDestination, checkDestination, runBackup,
    listBackupFiles, deleteBackupFile,
    restoreFromBuffer, restoreFromFile,
    parseBackupSettingsInput
};
