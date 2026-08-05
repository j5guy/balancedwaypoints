const Transaction = require('../../models/transaction');
const accountsDb = require('../database/accounts');
const schedulesDb = require('../database/schedules');
const { projectSchedule } = require('../schedules/occurrenceProjection');

// Calendar-unit stepping, same idea as services/schedules/nextOccurrence.js
// but for the forecast's own future window (weeks/months/years out from
// today) rather than a schedule's own recurrence — the two are unrelated
// concepts that happen to share the same unit vocabulary.
function addUnits(date, amount, unit) {
    const d = new Date(date);
    if (unit === 'weeks') d.setUTCDate(d.getUTCDate() + amount * 7);
    else if (unit === 'years') d.setUTCFullYear(d.getUTCFullYear() + amount);
    else if (unit === 'days') d.setUTCDate(d.getUTCDate() + amount);
    else d.setUTCMonth(d.getUTCMonth() + amount); // 'months' default
    return d;
}

function dayKey(date) {
    return date.toISOString().slice(0, 10);
}

// Past segment: one point per calendar day from (today - pastDays) to
// today, using real posted transactions. Anchored off accountsDb.balanceFor
// (today's true balance, same formula as the Accounts page and
// services/reports/netWorth.js) and walked backward by the window's own
// transactions, rather than forward from the account's starting balance —
// cheaper, and avoids re-summing the account's entire history for what's
// usually just a ~10-day window.
async function pastSegment(accountId, pastDays, currentBalanceCents) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - pastDays);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const txns = await Transaction.find({ account: accountId, date: { $gte: start } })
        .select('date amountCents').lean();
    const byDay = new Map();
    let sumInWindow = 0;
    for (const t of txns) {
        const key = dayKey(new Date(t.date));
        byDay.set(key, (byDay.get(key) || 0) + t.amountCents);
        sumInWindow += t.amountCents;
    }

    const rows = [];
    let running = currentBalanceCents - sumInWindow; // balance as of the day before `start`
    for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = dayKey(d);
        running += byDay.get(key) || 0;
        rows.push({ date: key, balanceCents: running, projected: false });
    }
    return rows;
}

// Future segment: one point per projected schedule occurrence (not one per
// day — daily granularity isn't meaningful when nothing's happening between
// occurrences) out to a cutoff derived from the requested future window.
// Reuses projectSchedule as-is (models/schedule.js's occurrenceOverrides and
// already-posted occurrences are handled there) rather than re-deriving
// recurrence math — this is the same projection the register's "upcoming"
// list uses (services/schedules/occurrenceProjection.js), just summed into
// a running balance server-side instead of left as a raw occurrence list.
async function futureSegment(accountId, futureAmount, futureUnit, currentBalanceCents) {
    const asOf = new Date();
    const cutoff = addUnits(asOf, futureAmount, futureUnit);

    const scheduleDocs = await schedulesDb.listActiveForAccount(accountId);
    const occurrences = [];
    for (const schedule of scheduleDocs) {
        const projected = await projectSchedule(schedule, cutoff, asOf);
        occurrences.push(...projected);
    }
    occurrences.sort((a, b) => a.occurrenceDate - b.occurrenceDate);

    let running = currentBalanceCents;
    return occurrences.map((o) => {
        running += o.amountCents;
        return { date: dayKey(o.occurrenceDate), balanceCents: running, projected: true };
    });
}

// Returns a plain array (not { rows }) — same convention as
// incomeVsExpense.js/netWorth.js, wrapped into { rows } by the controller.
async function forecast({ accountId, pastDays = 10, futureAmount = 6, futureUnit = 'months' }) {
    const currentBalanceCents = await accountsDb.balanceFor(accountId);
    if (currentBalanceCents === null) return [];

    const [past, future] = await Promise.all([
        pastSegment(accountId, pastDays, currentBalanceCents),
        futureSegment(accountId, futureAmount, futureUnit, currentBalanceCents)
    ]);
    return [...past, ...future];
}

module.exports = forecast;
