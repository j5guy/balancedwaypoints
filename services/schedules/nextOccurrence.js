// Advances a date by a schedule's frequency. Kept as plain calendar-unit
// arithmetic (via the Date UTC setters) rather than a duration library —
// "every 1 month" needs to mean "same day next month", not "+30 days".
function nextOccurrence(date, frequency) {
    const next = new Date(date);
    const { unit, interval } = frequency;
    if (unit === 'days') next.setUTCDate(next.getUTCDate() + interval);
    else if (unit === 'weeks') next.setUTCDate(next.getUTCDate() + interval * 7);
    else if (unit === 'months') next.setUTCMonth(next.getUTCMonth() + interval);
    else if (unit === 'years') next.setUTCFullYear(next.getUTCFullYear() + interval);
    return next;
}

module.exports = nextOccurrence;
