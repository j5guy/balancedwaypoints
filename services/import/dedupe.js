const crypto = require('crypto');

// OFX's FITID is already a stable per-transaction id from the bank, so
// ofxImport.js uses it directly. CSV exports rarely include anything like
// that, so this derives a deterministic fallback from the fields that
// together make a transaction unique in practice — good enough to catch
// "re-imported the same date range twice", not a cryptographic guarantee.
function csvImportedId(accountId, { date, amountCents, payeeName }) {
    const key = `${accountId}|${date}|${amountCents}|${(payeeName || '').toLowerCase().trim()}`;
    return crypto.createHash('sha1').update(key).digest('hex');
}

async function partitionNewRows(rows, transactionsDb, ownerId) {
    const ids = rows.map(r => r.importedId).filter(Boolean);
    const existing = await transactionsDb.findByImportedIds(ids, ownerId);
    const existingIds = new Set(existing.map(t => t.importedId));
    return {
        newRows: rows.filter(r => !existingIds.has(r.importedId)),
        duplicateCount: rows.length - rows.filter(r => !existingIds.has(r.importedId)).length
    };
}

module.exports = { csvImportedId, partitionNewRows };
