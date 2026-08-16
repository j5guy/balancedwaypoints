// Advances a date by a schedule's frequency. Kept as plain calendar-unit
// arithmetic (via the Date UTC setters) rather than a duration library —
// "every 1 month" needs to mean "same day next month", not "+30 days".
//
// Two recurrence kinds, dispatched on frequency.kind:
//  - 'interval' (default, and every schedule from before ordinal-weekday
//    recurrence existed — see models/schedule.js) — step by a fixed
//    {unit, interval}.
//  - 'ordinalWeekday' — the Nth (or "last") weekday of every month, e.g.
//    "the 2nd Wednesday" or "the 2nd AND last Wednesday" (multiple
//    ordinals recur on all of them). `date` is assumed to already BE a
//    valid occurrence of the rule, same contract as the interval branch —
//    this returns the next one strictly after it.
//
// This is the one seam every recurrence-aware caller (occurrenceProjection.js,
// occurrenceOverrides.js's advanceOccurrences/occurrencesBetween below,
// services/schedules/scheduler.js) funnels a date-step through, so kind
// dispatch living here is what lets all of those work unchanged for
// ordinal-weekday schedules too.
function nextOccurrence(date, frequency) {
    if (frequency && frequency.kind === 'ordinalWeekday') {
        return scanForOrdinalWeekday(date, frequency, false);
    }
    const next = new Date(date);
    const { unit, interval } = frequency;
    if (unit === 'days') next.setUTCDate(next.getUTCDate() + interval);
    else if (unit === 'weeks') next.setUTCDate(next.getUTCDate() + interval * 7);
    else if (unit === 'months') next.setUTCMonth(next.getUTCMonth() + interval);
    else if (unit === 'years') next.setUTCFullYear(next.getUTCFullYear() + interval);
    return next;
}

// Every occurrence of `weekday` (0=Sunday..6=Saturday, matching
// Date#getUTCDay) within the given UTC month, oldest first — always 4 or 5
// dates, since any weekday falls 4-5 times in any calendar month.
function weekdayDatesInMonth(year, monthIndex, weekday) {
    const dates = [];
    const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    let day = 1 + ((weekday - firstOfMonth.getUTCDay() + 7) % 7);
    for (; day <= daysInMonth; day += 7) dates.push(new Date(Date.UTC(year, monthIndex, day)));
    return dates;
}

// Picks out just the requested ordinal(s) (1-4, or -1 for "last") from one
// month's full list of matching weekday dates — e.g. ordinals [2, -1] on a
// 5-date month returns that month's 2nd and 5th. An ordinal a given month
// doesn't have (e.g. asking for the 4th weekday in a month that only has
// 4 dates.length===4 so 4th exists, but a 5th on a 4-date month wouldn't)
// is simply absent from the result rather than erroring — deduped and
// sorted since the same date could theoretically be picked twice (e.g.
// ordinals [4, -1] on a 4-date month both point at the same date).
function pickOrdinals(monthDates, ordinals) {
    const picked = ordinals
        .map((ord) => (ord === -1 ? monthDates[monthDates.length - 1] : monthDates[ord - 1]))
        .filter(Boolean);
    return [...new Set(picked.map((d) => d.getTime()))].sort((a, b) => a - b).map((t) => new Date(t));
}

function ordinalWeekdayDatesInMonth(year, monthIndex, frequency) {
    return pickOrdinals(weekdayDatesInMonth(year, monthIndex, frequency.weekday), frequency.ordinals);
}

// Bounded to 36 months as a safety net (not a realistic limit) — every
// ordinal this app accepts (1-4, or -1 for "last") exists in literally
// every month for every weekday, so in practice this always resolves on
// the first or second month scanned.
const MAX_MONTHS_SCANNED = 36;

// `includeDateItself: true` is "first match on or after date" (used to
// snap a user-picked "starting from" date onto the rule when a schedule is
// created/edited — see controllers/schedulesController.js); false is
// "first match strictly after date" (the normal step-forward case).
function scanForOrdinalWeekday(date, frequency, includeDateItself) {
    let year = date.getUTCFullYear();
    let month = date.getUTCMonth();
    for (let i = 0; i < MAX_MONTHS_SCANNED; i++) {
        const candidates = ordinalWeekdayDatesInMonth(year, month, frequency);
        const match = candidates.find((d) => (includeDateItself ? d.getTime() >= date.getTime() : d.getTime() > date.getTime()));
        if (match) return match;
        month++;
        if (month > 11) { month = 0; year++; }
    }
    return new Date(date);
}

// See scanForOrdinalWeekday's includeDateItself doc above.
function firstOrdinalWeekdayOnOrAfter(date, frequency) {
    return scanForOrdinalWeekday(date, frequency, true);
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
module.exports.firstOrdinalWeekdayOnOrAfter = firstOrdinalWeekdayOnOrAfter;
