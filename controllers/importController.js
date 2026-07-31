const { parseCsv } = require('../services/import/csvImport');
const { parseOfx } = require('../services/import/ofxImport');
const { partitionNewRows } = require('../services/import/dedupe');
const transactionsDb = require('../services/database/transactions');
const rulesDb = require('../services/database/rules');
const payeesDb = require('../services/database/payees');
const tagsDb = require('../services/database/tags');
const { applyRules } = require('../services/rules/applyRules');

// Parses the uploaded file and returns rows enriched with a duplicate flag
// and a rule-based category/tag suggestion — nothing is written to the
// database yet. The client reviews/edits these, then POSTs the confirmed
// set to /commit.
async function preview(req, res) {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { accountId, format } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });
    if (!['csv', 'ofx'].includes(format)) return res.status(400).json({ error: 'format must be "csv" or "ofx"' });

    const parser = format === 'csv' ? parseCsv : parseOfx;
    const { rows, errors } = parser(req.file.buffer, accountId);
    if (rows.length === 0) return res.status(400).json({ error: 'No usable rows found', details: errors });

    const { newRows, duplicateCount } = await partitionNewRows(rows, transactionsDb);
    const activeRules = await rulesDb.findActive();

    const preview = await Promise.all(newRows.map(async (row) => {
        const suggestion = await applyRules(activeRules, { payee: row.payeeName, notes: row.notes, amountCents: row.amountCents });
        return { ...row, suggestedCategoryId: suggestion.categoryId, suggestedPayeeName: suggestion.payeeName, suggestedTagNames: suggestion.tagNames };
    }));

    res.json({ rows: preview, duplicateCount, errors });
}

// Body: { accountId, rows: [{ date, payeeName, amountCents, notes, importedId, categoryId, tagNames }] }
async function commit(req, res) {
    const { accountId, rows } = req.body || {};
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows must be a non-empty array' });

    let created = 0;
    for (const row of rows) {
        const payee = row.payeeName ? await payeesDb.findOrCreateByName(row.payeeName) : null;
        const tags = await Promise.all((row.tagNames || []).map(name => tagsDb.findOrCreateByName(name)));

        await transactionsDb.create({
            account: accountId,
            date: row.date,
            payee: payee ? payee._id : null,
            amountCents: Number(row.amountCents),
            category: row.categoryId || null,
            cleared: 'cleared',
            tags: tags.filter(Boolean).map(t => t._id),
            notes: row.notes || '',
            importedId: row.importedId || null
        });
        created++;
    }

    res.status(201).json({ created });
}

module.exports = { preview, commit };
