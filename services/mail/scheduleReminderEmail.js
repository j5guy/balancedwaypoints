const { wrapEmail, button } = require('./emailLayout');
const { formatCents } = require('../../utils/money');
const config = require('../../config/config');

// schedule must have account/payee populated (see services/database/schedules.js).
function scheduleReminderEmail(schedule) {
    const dueDate = new Date(schedule.nextDate).toLocaleDateString();
    const accountName = schedule.account && schedule.account.name ? schedule.account.name : 'an account';
    const payeeName = schedule.payee && schedule.payee.name ? schedule.payee.name : null;

    const bodyHtml = `
        <p><strong>${schedule.name}</strong> is due on ${dueDate}${payeeName ? ` — ${payeeName}` : ''}.</p>
        <p>Amount: <strong>${formatCents(schedule.amountCents)}</strong> (${accountName})</p>
        ${schedule.notes ? `<p>${schedule.notes}</p>` : ''}
        ${button(`${config.appBaseUrl}/schedules`, 'View schedules')}
    `;

    return {
        subject: `Balanced Waypoints: "${schedule.name}" is due ${dueDate}`,
        html: wrapEmail({ title: 'Upcoming scheduled transaction', bodyHtml })
    };
}

module.exports = scheduleReminderEmail;
