const { wrapEmail, button } = require('./emailLayout');
const config = require('../../config/config');

function backupFailureEmail(errorMessage, scope = 'site') {
    const isUser = scope === 'user';
    const linkPath = isUser ? '/account' : '/admin/backups';
    const linkLabel = isUser ? 'Open My Account' : 'Open Admin > Backups';
    const kind = isUser ? 'Your scheduled personal backup' : 'A scheduled site backup';

    const bodyHtml = `
        <p>${kind} failed to complete:</p>
        <p style="background:#F6F5F1;border-radius:8px;padding:12px 16px;font-family:monospace;font-size:0.85rem;">${errorMessage}</p>
        <p>No new backup was written this run — check the destination (disk space, a dropped network mount, permissions) from ${isUser ? 'My Account' : 'Admin > Backups'}.</p>
        ${button(`${config.appBaseUrl}${linkPath}`, linkLabel)}
    `;

    return {
        subject: `Balanced Waypoints: scheduled ${isUser ? 'personal ' : ''}backup failed`,
        html: wrapEmail({ title: 'Scheduled backup failed', bodyHtml })
    };
}

module.exports = backupFailureEmail;
