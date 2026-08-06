const { wrapEmail, button } = require('./emailLayout');
const { formatCents } = require('../../utils/money');
const config = require('../../config/config');
const spendingByCategory = require('../reports/spendingByCategory');
const accountsDb = require('../database/accounts');

const ROW_STYLE = 'padding:4px 8px;border-bottom:1px solid #EAE7DE;';

async function weeklyReportEmail(ownerId) {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [spending, accountBalances] = await Promise.all([
        spendingByCategory({ from: from.toISOString(), to: to.toISOString(), ownerId }),
        accountsDb.balancesForAll(ownerId)
    ]);

    const spendingRows = spending.slice(0, 10).map((row) => `
        <tr>
            <td style="${ROW_STYLE}">${row.category ? row.category.name : 'Uncategorized'}</td>
            <td style="${ROW_STYLE}text-align:right;">${formatCents(row.totalCents)}</td>
        </tr>`).join('');

    const balanceRows = accountBalances
        .filter(({ account }) => !account.closed)
        .map(({ account, balanceCents }) => `
        <tr>
            <td style="${ROW_STYLE}">${account.name}</td>
            <td style="${ROW_STYLE}text-align:right;">${formatCents(balanceCents)}</td>
        </tr>`).join('');

    const bodyHtml = `
        <p>Here's your week — ${from.toLocaleDateString()} to ${to.toLocaleDateString()}.</p>
        <h3 style="font-size:1rem;margin-bottom:6px;">Spending by category</h3>
        <table style="width:100%;border-collapse:collapse;">
            ${spendingRows || `<tr><td style="${ROW_STYLE}">No spending this week.</td></tr>`}
        </table>
        <h3 style="font-size:1rem;margin:20px 0 6px;">Account balances</h3>
        <table style="width:100%;border-collapse:collapse;">
            ${balanceRows || `<tr><td style="${ROW_STYLE}">No accounts yet.</td></tr>`}
        </table>
        ${button(`${config.appBaseUrl}/reports`, 'View full reports')}
    `;

    return {
        subject: 'Balanced Waypoints: your weekly summary',
        html: wrapEmail({ title: 'Weekly summary', bodyHtml })
    };
}

module.exports = weeklyReportEmail;
