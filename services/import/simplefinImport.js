// Normalizes one SimpleFIN remote account's transactions into the same row
// shape services/import/csvImport.js and ofxImport.js produce, so the sync
// path can reuse the existing dedupe (services/import/dedupe.js) and rules
// (services/rules/applyRules.js) pipeline instead of a parallel one.
// SimpleFIN's own `id` is a stable per-transaction id from the bridge —
// used directly as the dedup key, same idea as OFX's FITID.
function parseRows(remoteAccount, localAccountId) {
    const errors = [];
    const rows = [];

    (remoteAccount.transactions || []).forEach((txn, i) => {
        const amountCents = txn.amount != null ? Math.round(parseFloat(txn.amount) * 100) : null;
        const date = txn.posted ? new Date(txn.posted * 1000) : null;

        if (!date || isNaN(date.getTime()) || amountCents == null || isNaN(amountCents)) {
            errors.push(`Transaction ${i + 1}: missing/unparseable posted date or amount — skipped`);
            return;
        }
        if (!txn.id) {
            errors.push(`Transaction ${i + 1}: missing id — skipped (can't dedupe safely without one)`);
            return;
        }

        rows.push({
            date: date.toISOString(),
            payeeName: (txn.payee || txn.description || '').trim(),
            amountCents,
            notes: (txn.memo || '').trim(),
            pending: !!txn.pending,
            importedId: `simplefin:${localAccountId}:${txn.id}`
        });
    });

    return { rows, errors };
}

module.exports = { parseRows };
