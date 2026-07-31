const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

function parseCsvBuffer(buffer) {
    return parse(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true
    });
}

function toCsv(rows, columns) {
    return stringify(rows, { header: true, columns });
}

module.exports = { parseCsvBuffer, toCsv };
