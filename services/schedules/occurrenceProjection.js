// Server-side occurrence projection for a schedule's "upcoming" rows in the
// register. Moved server-side (rather than the client just walking
// schedule.nextDate forward, as it used to) because it now needs to
// cross-reference which occurrences already have a posted Transaction
// (models/transaction.js's scheduleOccurrenceDate) — data only the server
// can efficiently query — and merge in any occurrenceOverrides (including
// "skip" ones, which delete an occurrence outright — see models/schedule.js).
const Transaction = require('../../models/transaction');
const nextOccurrence = require('./nextOccurrence');
const { resolve: resolveOverride } = require('./occurrenceOverrides');

const MAX_STEPS = 1000;

async function postedOccurrenceSet(scheduleId) {
    const rows = await Transaction.find({ schedule: scheduleId, scheduleOccurrenceDate: { $ne: null } })
        .select('scheduleOccurrenceDate').lean();
    return new Set(rows.map(r => new Date(r.scheduleOccurrenceDate).getTime()));
}

function isSkipped(schedule, date, frequency) {
    const override = resolveOverride(schedule.occurrenceOverrides, date, frequency);
    return !!(override && override.skip);
}

// nextDate is meant to always sit at the earliest occurrence that still
// needs action (not yet posted, not deleted). Manually posting an
// occurrence out of order (e.g. skipping ahead to pay next month's bill
// early while this month's is still pending) can't just advance it by one
// step the way the old auto-enter-only cron did — so instead this walks
// forward from wherever nextDate currently is, skipping past anything
// that's already posted OR has been deleted via a "skip" override, and
// persists the result if it moved. Called both before projecting
// (self-heals a stale nextDate the next time it's viewed) and right after
// posting or deleting an occurrence.
async function advanceNextDatePastPosted(schedule, posted) {
    const set = posted || await postedOccurrenceSet(schedule._id);
    let date = new Date(schedule.nextDate);
    let steps = 0;
    while ((set.has(date.getTime()) || isSkipped(schedule, date, schedule.frequency)) && steps < MAX_STEPS) {
        date = nextOccurrence(date, schedule.frequency);
        steps++;
    }
    if (steps > 0) {
        schedule.nextDate = date;
        await schedule.save();
    }
    return date;
}

// Projects every not-yet-posted, not-deleted occurrence of `schedule` from
// its (self-healed) nextDate out to `cutoff`, merging in any
// occurrenceOverrides and flagging ones at/before `asOf` as due.
//
// `viewingAccountId` is only meaningful for a transfer schedule — it's
// attached to BOTH accounts (see services/database/schedules.js's
// listActiveForAccount) but only stores one signed magnitude, so this
// normalizes it here, once, for every caller: negative on the paying side,
// positive on the receiving side, the same way
// services/database/transactions.js's createTransfer signs the two real
// Transaction legs once a transfer schedule actually posts. Both
// controllers/schedulesController.js's upcoming() (the register's "upcoming"
// rows) and services/reports/forecast.js's futureSegment() (the Forecast
// widget) call this, and both need this same normalization — centralizing
// it here means neither has to re-derive it, and neither can drift out of
// sync with the other or with how a posted transfer actually signs its
// amounts.
async function projectSchedule(schedule, cutoff, asOf = new Date(), viewingAccountId = null) {
    const posted = await postedOccurrenceSet(schedule._id);
    const frequency = schedule.frequency;
    const endDate = schedule.endDate ? new Date(schedule.endDate) : null;

    let date = await advanceNextDatePastPosted(schedule, posted);

    const isTransfer = !!schedule.transferAccount;
    const viewingIncomingSide = isTransfer && viewingAccountId != null &&
        String(schedule.transferAccount._id || schedule.transferAccount) === String(viewingAccountId);

    const occurrences = [];
    let steps = 0;
    while (date <= cutoff && (!endDate || date <= endDate) && steps < MAX_STEPS) {
        if (!posted.has(date.getTime())) {
            const override = resolveOverride(schedule.occurrenceOverrides, date, frequency);
            if (!override || !override.skip) {
                let amountCents = override ? override.amountCents : schedule.amountCents;
                if (isTransfer) amountCents = viewingIncomingSide ? Math.abs(amountCents) : -Math.abs(amountCents);
                occurrences.push({
                    schedule,
                    occurrenceDate: new Date(date),
                    amountCents,
                    category: override ? override.category : schedule.category,
                    payee: override ? override.payee : schedule.payee,
                    notes: override ? override.notes : schedule.notes,
                    splits: override ? override.splits : schedule.splits,
                    isDue: date <= asOf
                });
            }
        }
        date = nextOccurrence(date, frequency);
        steps++;
    }
    return occurrences;
}

module.exports = { projectSchedule, advanceNextDatePastPosted, postedOccurrenceSet };
