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

// Steps forward `times` occurrences from `date` (0 returns `date` itself
// unchanged) — used to turn an override's "applies to N occurrences"
// count into the exclusive end-date of its range.
function advanceOccurrences(date, frequency, times) {
    let d = new Date(date);
    for (let i = 0; i < times; i++) d = nextOccurrence(d, frequency);
    return d;
}

// Inverse of advanceOccurrences — counts how many occurrence-steps from
// `start` land exactly on `end` (both must be real occurrence dates of the
// same schedule, i.e. `end` reachable by repeatedly stepping `start`).
// Bounded by a generous guard since a schedule's own occurrences are
// finite in any practical range.
function occurrencesBetween(start, end, frequency) {
    let count = 0;
    let d = new Date(start);
    while (d < end && count < 10000) {
        d = nextOccurrence(d, frequency);
        count++;
    }
    return count;
}

module.exports = nextOccurrence;
module.exports.advanceOccurrences = advanceOccurrences;
module.exports.occurrencesBetween = occurrencesBetween;
