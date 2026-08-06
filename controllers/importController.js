const { parseCsv } = require('../services/import/csvImport');
const { parseOfx } = require('../services/import/ofxImport');
const { partitionNewRows } = require('../services/import/dedupe');
const transactionsDb = require('../services/database/transactions');
const rulesDb = require('../services/database/rules');
const payeesDb = require('../services/database/payees');
const tagsDb = require('../services/database/tags');
const categoriesDb = require('../services/database/categories');
const categoryGroupsDb = require('../services/database/categoryGroups');
const { applyRules } = require('../services/rules/applyRules');
const logger = require('../utils/logger');

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

    const { newRows, duplicateCount } = await partitionNewRows(rows, transactionsDb, req.session.userId);
    const activeRules = await rulesDb.findActive(req.session.userId);
    const allCategories = await categoriesDb.list(req.session.userId, { includeArchived: true });

    const preview = await Promise.all(newRows.map(async (row) => {
        const suggestion = await applyRules(activeRules, { payee: row.payeeName, notes: row.notes, amountCents: row.amountCents });
        // Rules take priority; if none matched, fall back to the CSV's own
        // Category column when it names a category that already exists.
        let suggestedCategoryId = suggestion.categoryId;
        if (!suggestedCategoryId && row.categoryName) {
            const match = allCategories.find(c => c.name.toLowerCase() === row.categoryName.toLowerCase());
            if (match) suggestedCategoryId = match._id;
        }
        return { ...row, suggestedCategoryId, suggestedPayeeName: suggestion.payeeName, suggestedTagNames: suggestion.tagNames };
    }));

    res.json({ rows: preview, duplicateCount, errors });
}

// Body: { accountId, rows: [{ date, payeeName, amountCents, notes, importedId, categoryId, categoryName, categoryGroupName, tagNames }] }
async function commit(req, res) {
    const { accountId, rows } = req.body || {};
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows must be a non-empty array' });

    const ownerId = req.session.userId;

    // Every imported row would otherwise get the schema's default sortOrder
    // (Date.now() at the moment it's created) — since this loop creates rows
    // sequentially, that default increases with processing order, which is
    // backwards from what services/database/transactions.js's SORTS wants
    // for a same-date tiebreak (descending = earliest-in-the-batch shown
    // first). Assigning a strictly decreasing value up front, matching the
    // rows' own order (already the CSV's file order — see
    // services/import/dedupe.js's order-preserving filter), fixes that:
    // same-date rows now display in the same order they were in the file,
    // regardless of overall sort direction. Only relative order among rows
    // sharing the same date ever actually matters here (see the SORTS
    // comment), so a single shared, strictly-decreasing counter for the
    // whole batch is enough — no need to reset it per date.
    let sortOrder = Date.now();

    // payee/category resolution used to be un-guarded — any failure there
    // (a Mongo validation/cast error, an unexpected 11000 shape, etc.) would
    // still let the transaction itself get created moments later, just with
    // that field silently left null, and the client never learned anything
    // went wrong. Wrapping each resolution means a failure is visible (in
    // `warnings`, returned to the client, and logged with the actual row so
    // it's traceable server-side) instead of quietly dropping data.
    let created = 0;
    const warnings = [];
    for (const row of rows) {
        const rowLabel = row.payeeName || row.notes || row.date || '(unlabeled row)';

        let payee = null;
        if (row.payeeName) {
            try {
                payee = await payeesDb.findOrCreateByName(row.payeeName, ownerId);
            } catch (err) {
                logger.error(`Import: failed to resolve payee "${row.payeeName}" for row "${rowLabel}": ${err.message}`);
                warnings.push(`"${rowLabel}": couldn't create/find payee "${row.payeeName}" — ${err.message}`);
            }
        }

        const tags = await Promise.all((row.tagNames || []).map(name => tagsDb.findOrCreateByName(name, ownerId)));

        // No categoryId was picked (the CSV named a category that doesn't
        // exist yet) — create the group and category on the fly. Group and
        // category resolution are logged/reported SEPARATELY (rather than
        // one combined "couldn't resolve category" message) because a null
        // result with no thrown error could come from either step, and
        // which one it is changes where the actual bug lives.
        let categoryId = row.categoryId || null;
        if (!categoryId && row.categoryName) {
            const groupName = row.categoryGroupName || 'Imported';
            try {
                const group = await categoryGroupsDb.findOrCreateByName(groupName, ownerId);
                if (!group) {
                    logger.error(`Import: categoryGroupsDb.findOrCreateByName("${groupName}", ${ownerId}) returned falsy with no error, for row "${rowLabel}"`);
                    warnings.push(`"${rowLabel}": category group "${groupName}" didn't resolve (no error thrown — see server log)`);
                } else {
                    const category = await categoriesDb.findOrCreateByName(row.categoryName, group._id, ownerId);
                    if (!category) {
                        logger.error(`Import: categoriesDb.findOrCreateByName("${row.categoryName}", group=${group._id}, ${ownerId}) returned falsy with no error, for row "${rowLabel}"`);
                        warnings.push(`"${rowLabel}": category "${row.categoryName}" didn't resolve inside group "${groupName}" (id ${group._id}, no error thrown — see server log)`);
                    } else {
                        categoryId = category._id;
                    }
                }
            } catch (err) {
                logger.error(`Import: exception resolving category "${row.categoryName}" (group "${groupName}") for row "${rowLabel}": ${err.stack || err.message}`);
                warnings.push(`"${rowLabel}": couldn't create/find category "${row.categoryName}" — ${err.message}`);
            }
        }

        await transactionsDb.create({
            owner: ownerId,
            account: accountId,
            date: row.date,
            payee: payee ? payee._id : null,
            amountCents: Number(row.amountCents),
            category: categoryId,
            cleared: 'cleared',
            tags: tags.filter(Boolean).map(t => t._id),
            notes: row.notes || '',
            importedId: row.importedId || null,
            sortOrder: sortOrder--
        });
        created++;
    }

    res.status(201).json({ created, warnings });
}

module.exports = { preview, commit };
