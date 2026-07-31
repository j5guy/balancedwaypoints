// Editing a single occurrence of a recurring schedule ("just this one" /
// "this and the next N" / "this and every one after") without touching the
// base Schedule's own fields (which would affect PAST/already-posted
// occurrences too, and every occurrence before the one being edited).
//
// Each override is a full snapshot (amountCents/category/payee/notes/splits)
// covering a date range [occurrenceDate, occurrenceDate + N occurrences), or
// unbounded ("forever") when occurrenceCount is null. Overrides never
// overlap — reconcile() below splits/truncates/removes any existing
// override whose range collides with a newly-saved one, the same way
// calendar apps resolve "edit this and following" against a previously
// split series. A new override landing in the MIDDLE of an existing one
// splits it into a head (before) and a tail (after) that keeps the
// existing override's own values — only the newly-edited slice changes.
const { advanceOccurrences, occurrencesBetween } = require('./nextOccurrence');

function endExclusive(occurrenceDate, occurrenceCount, frequency) {
    if (occurrenceCount === null || occurrenceCount === undefined) return null;
    return advanceOccurrences(occurrenceDate, frequency, occurrenceCount);
}

function plainWithoutId(existing) {
    const obj = { ...(existing.toObject ? existing.toObject() : existing) };
    delete obj._id;
    return obj;
}

// Mutates nothing — returns a brand new overrides array with `entry` applied
// and any colliding existing overrides split/truncated/removed as needed.
function reconcile(existingOverrides, entry, frequency) {
    const newStart = new Date(entry.occurrenceDate);
    const newEnd = endExclusive(newStart, entry.occurrenceCount, frequency);

    const result = [];
    for (const existing of existingOverrides) {
        const exStart = new Date(existing.occurrenceDate);
        const exEnd = endExclusive(exStart, existing.occurrenceCount, frequency);

        const entirelyBefore = exEnd !== null && exEnd <= newStart;
        const entirelyAfter = newEnd !== null && exStart >= newEnd;
        if (entirelyBefore || entirelyAfter) {
            result.push(existing);
            continue;
        }

        const swallowed = exStart >= newStart && (newEnd === null || (exEnd !== null && exEnd <= newEnd));
        if (swallowed) {
            // Fully inside the new range — superseded entirely, dropped.
            continue;
        }

        const startsBeforeNew = exStart < newStart;
        const extendsPastNewEnd = newEnd !== null && (exEnd === null || exEnd > newEnd);

        if (startsBeforeNew) {
            // Overlaps the new range's front — truncate to end right where
            // the new range begins.
            result.push({
                ...plainWithoutId(existing),
                occurrenceCount: occurrencesBetween(exStart, newStart, frequency)
            });
        }
        if (extendsPastNewEnd) {
            // Either straddled the new range's front (both branches fire,
            // producing a head + tail either side of it) or started inside
            // it but ran past the end — either way, the portion after the
            // new range keeps existing's own values as a fresh tail entry.
            result.push({
                ...plainWithoutId(existing),
                occurrenceDate: newEnd,
                occurrenceCount: exEnd === null ? null : occurrencesBetween(newEnd, exEnd, frequency)
            });
        }
    }

    result.push(entry);
    return result;
}

// Finds the override (if any) covering a given occurrence date — at most
// one should ever match since reconcile() keeps ranges non-overlapping.
function resolve(overrides, occurrenceDate, frequency) {
    const d = new Date(occurrenceDate);
    return overrides.find((o) => {
        const start = new Date(o.occurrenceDate);
        if (d < start) return false;
        const end = endExclusive(start, o.occurrenceCount, frequency);
        return end === null || d < end;
    }) || null;
}

module.exports = { reconcile, resolve };
