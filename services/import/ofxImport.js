// Minimal OFX/QFX parser — no dependency, since OFX 1.x is SGML-ish (leaf
// tags are often unclosed, e.g. "<DTPOSTED>20240115000000") rather than
// strict XML, and all we need out of it is the <STMTTRN> transaction blocks.
// TRNAMT is already signed (negative=outflow, positive=inflow) per the OFX
// spec, matching this app's amountCents convention directly — no debit/
// credit-column guessing needed the way CSV import has to do.
function extractTag(block, tag) {
    const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
    return match ? match[1].trim() : null;
}

function parseOfxDate(raw) {
    if (!raw || raw.length < 8) return null;
    const year = raw.slice(0, 4);
    const month = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    return isNaN(date.getTime()) ? null : date;
}

function parseOfx(buffer, accountId) {
    const text = buffer.toString('utf8');
    const errors = [];
    const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
    if (blocks.length === 0) {
        errors.push('No <STMTTRN> transaction blocks found — is this a valid OFX/QFX file?');
        return { rows: [], errors };
    }

    const rows = [];
    blocks.forEach((block, i) => {
        const dtposted = extractTag(block, 'DTPOSTED');
        const trnamt = extractTag(block, 'TRNAMT');
        const fitid = extractTag(block, 'FITID');
        const name = extractTag(block, 'NAME') || extractTag(block, 'PAYEE');
        const memo = extractTag(block, 'MEMO');

        const date = parseOfxDate(dtposted);
        const amountCents = trnamt != null ? Math.round(parseFloat(trnamt) * 100) : null;

        if (!date || amountCents == null || isNaN(amountCents)) {
            errors.push(`Transaction ${i + 1}: missing/unparseable DTPOSTED or TRNAMT — skipped`);
            return;
        }

        rows.push({
            date: date.toISOString(),
            payeeName: (name || '').trim(),
            amountCents,
            notes: (memo || '').trim(),
            // FITID is the bank's own stable transaction id — used directly
            // as the dedup key, prefixed per-account since FITIDs are only
            // guaranteed unique within a single account's statement.
            importedId: fitid ? `ofx:${accountId}:${fitid}` : null
        });
    });

    return { rows, errors };
}

module.exports = { parseOfx };
