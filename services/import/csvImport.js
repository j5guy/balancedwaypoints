// Tolerant bank-CSV import: banks disagree on column names and on whether
// they export a single signed Amount column or separate Debit/Credit
// columns, so this sniffs the header row for the first match of each field
// rather than requiring an exact, fixed set of column names.
const { parseCsvBuffer } = require('../csv/csvUtils');
const { csvImportedId } = require('./dedupe');

const DATE_HEADERS = ['date', 'transaction date', 'posted date', 'post date'];
const PAYEE_HEADERS = ['payee', 'description', 'name', 'merchant', 'transaction'];
const AMOUNT_HEADERS = ['amount'];
const DEBIT_HEADERS = ['debit', 'withdrawal', 'withdrawals'];
const CREDIT_HEADERS = ['credit', 'deposit', 'deposits'];
const NOTES_HEADERS = ['memo', 'notes', 'note'];

function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase();
}

function findHeader(headers, candidates) {
    return headers.find(h => candidates.includes(normalizeHeader(h))) || null;
}

// Handles "1,234.56", "-1234.56", and accounting-style "(1234.56)" for negatives.
function parseAmountToCents(raw) {
    if (raw == null || raw === '') return null;
    let str = String(raw).trim();
    let negative = false;
    if (str.startsWith('(') && str.endsWith(')')) {
        negative = true;
        str = str.slice(1, -1);
    }
    str = str.replace(/[^0-9.\-]/g, '');
    const value = parseFloat(str);
    if (isNaN(value)) return null;
    const cents = Math.round(value * 100);
    return negative ? -Math.abs(cents) : cents;
}

// Returns { rows, errors } — rows are plain objects, nothing is written to
// the database yet (see controllers/importController.js for the
// preview/confirm flow).
function parseCsv(buffer, accountId) {
    const records = parseCsvBuffer(buffer);
    const errors = [];
    if (records.length === 0) return { rows: [], errors: ['No rows found in file'] };

    const headers = Object.keys(records[0]);
    const dateHeader = findHeader(headers, DATE_HEADERS);
    const payeeHeader = findHeader(headers, PAYEE_HEADERS);
    const amountHeader = findHeader(headers, AMOUNT_HEADERS);
    const debitHeader = findHeader(headers, DEBIT_HEADERS);
    const creditHeader = findHeader(headers, CREDIT_HEADERS);
    const notesHeader = findHeader(headers, NOTES_HEADERS);

    if (!dateHeader) errors.push('Could not find a Date column');
    if (!amountHeader && !debitHeader && !creditHeader) errors.push('Could not find an Amount (or Debit/Credit) column');
    if (errors.length) return { rows: [], errors };

    const rows = [];
    records.forEach((record, i) => {
        const rowNum = i + 2;
        const rawDate = record[dateHeader];
        const date = rawDate ? new Date(rawDate) : null;
        if (!date || isNaN(date.getTime())) {
            errors.push(`Row ${rowNum}: unparseable date "${rawDate}" — skipped`);
            return;
        }

        let amountCents;
        if (amountHeader) {
            amountCents = parseAmountToCents(record[amountHeader]);
        } else {
            const debit = parseAmountToCents(record[debitHeader]) || 0;
            const credit = parseAmountToCents(record[creditHeader]) || 0;
            amountCents = credit - Math.abs(debit);
        }
        if (amountCents == null) {
            errors.push(`Row ${rowNum}: unparseable amount — skipped`);
            return;
        }

        const payeeName = payeeHeader ? String(record[payeeHeader] || '').trim() : '';
        const notes = notesHeader ? String(record[notesHeader] || '').trim() : '';
        const isoDate = date.toISOString();

        rows.push({
            date: isoDate,
            payeeName,
            amountCents,
            notes,
            importedId: csvImportedId(accountId, { date: isoDate, amountCents, payeeName })
        });
    });

    return { rows, errors };
}

module.exports = { parseCsv, parseAmountToCents };
