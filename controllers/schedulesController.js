const schedules = require('../services/database/schedules');
const transactionsDb = require('../services/database/transactions');
const accountShares = require('../services/database/accountShares');
const { resolveActingOwner } = require('../services/authz/actingOwner');
const { FREQUENCY_UNITS } = require('../models/schedule');
const { projectSchedule, advanceNextDatePastPosted } = require('../services/schedules/occurrenceProjection');
const { resolve: resolveOverride } = require('../services/schedules/occurrenceOverrides');

function serialize(schedule) {
    const now = new Date();
    const dueInDays = Math.ceil((schedule.nextDate - now) / (1000 * 60 * 60 * 24));
    return {
        id: schedule._id,
        name: schedule.name,
        account: schedule.account._id || schedule.account,
        payee: schedule.payee ? { id: schedule.payee._id, name: schedule.payee.name } : null,
        amountCents: schedule.amountCents,
        category: schedule.category ? { id: schedule.category._id, name: schedule.category.name } : null,
        splits: schedule.splits,
        frequency: schedule.frequency,
        nextDate: schedule.nextDate,
        endDate: schedule.endDate,
        autoEnter: schedule.autoEnter,
        reminderDaysBefore: schedule.reminderDaysBefore,
        active: schedule.active,
        notes: schedule.notes,
        // "Upcoming" is computed here, never stored — a schedule is due soon
        // once we're within its own reminder window of nextDate.
        dueSoon: schedule.active && dueInDays <= schedule.reminderDaysBefore,
        // See services/jobs/scheduleReminderEmailJob.js — emails everyone
        // with their own SMTP configured once this occurrence goes dueSoon.
        notifyByEmail: schedule.notifyByEmail
    };
}

function validateSplits(amountCents, splits) {
    if (!splits || splits.length === 0) return null;
    const sum = splits.reduce((s, split) => s + Number(split.amountCents), 0);
    if (sum !== Number(amountCents)) return 'Split amounts must add up to the schedule total';
    return null;
}

// Every write below resolves access via the schedule's own `account` (not
// a flat req.session.userId match, or the `?for=` owner-switcher other
// management controllers use) — schedules stay account-scoped even though
// Categories/Payees/Tags/Rules go owner-wide once any readwrite share
// exists. See services/database/accountShares.js's resolveAccountAccess
// and the Phase 2 plan's access-tiers table. Mirrors
// controllers/transactionsController.js's requireAccountAccess.
async function requireAccountAccess(req, res, accountId, { write = false } = {}) {
    if (!accountId) {
        res.status(400).json({ error: 'account is required' });
        return null;
    }
    const access = await accountShares.resolveAccountAccess(accountId, req.session.userId);
    if (!access) {
        res.status(404).json({ error: 'Not found' });
        return null;
    }
    if (write && access.role === 'readonly') {
        res.status(403).json({ error: 'You have read-only access to this account' });
        return null;
    }
    return access;
}

// The one list endpoint that isn't keyed to a single account, so it uses
// the `?for=<ownerId>` "Managing: [owner]" switcher instead — but unlike
// Categories/Payees/Tags/Rules (owner-wide once any readwrite share
// exists), schedules are additionally filtered down to just the accounts
// the acting user specifically holds readwrite on.
async function list(req, res) {
    const ctx = await resolveActingOwner(req, res);
    if (!ctx) return;
    let items = await schedules.list(ctx.ownerId);
    if (String(ctx.ownerId) !== String(req.session.userId)) {
        const writable = await accountShares.listWritableAccountIds(req.session.userId, ctx.ownerId);
        items = items.filter(s => writable.has(String((s.account && s.account._id) || s.account)));
    }
    res.json({ schedules: items.map(serialize) });
}

async function create(req, res) {
    const { name, account, payee, amountCents, category, splits, frequency, nextDate, endDate, autoEnter, reminderDaysBefore, notes, notifyByEmail } = req.body || {};
    const access = await requireAccountAccess(req, res, account, { write: true });
    if (!access) return;
    if (!String(name || '').trim()) return res.status(400).json({ error: 'name is required' });
    if (amountCents === undefined) return res.status(400).json({ error: 'amountCents is required' });
    if (!nextDate) return res.status(400).json({ error: 'nextDate is required' });
    if (frequency && frequency.unit && !FREQUENCY_UNITS.includes(frequency.unit)) return res.status(400).json({ error: 'Invalid frequency unit' });
    const splitError = validateSplits(amountCents, splits);
    if (splitError) return res.status(400).json({ error: splitError });

    const schedule = await schedules.create({
        owner: access.ownerId,
        name: String(name).trim(), account, payee: payee || null,
        amountCents: Number(amountCents),
        category: splits && splits.length ? null : (category || null),
        splits: splits || [],
        frequency: frequency || { unit: 'months', interval: 1 },
        nextDate, endDate: endDate || null,
        autoEnter: !!autoEnter,
        reminderDaysBefore: reminderDaysBefore !== undefined ? Number(reminderDaysBefore) : 3,
        notes: notes || '',
        notifyByEmail: !!notifyByEmail
    });
    const populated = await schedules.findById(schedule._id, access.ownerId);
    res.status(201).json(serialize(populated));
}

async function update(req, res) {
    const existing = await schedules.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const access = await requireAccountAccess(req, res, existing.account, { write: true });
    if (!access) return;

    const { name, account, payee, amountCents, category, splits, frequency, nextDate, endDate, autoEnter, reminderDaysBefore, active, notes, notifyByEmail } = req.body || {};
    if (frequency && frequency.unit && !FREQUENCY_UNITS.includes(frequency.unit)) return res.status(400).json({ error: 'Invalid frequency unit' });

    // Moving a schedule to a different account requires write access to
    // THAT account too, and — same reasoning as transactionsController's
    // account-move check — the target must belong to the SAME owner, since
    // the schedule's own `owner` field doesn't change here.
    if (account !== undefined && String(account) !== String(existing.account)) {
        const targetAccess = await requireAccountAccess(req, res, account, { write: true });
        if (!targetAccess) return;
        if (String(targetAccess.ownerId) !== String(access.ownerId)) {
            return res.status(400).json({ error: "Can't move a schedule to an account with a different owner" });
        }
    }

    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (account !== undefined) data.account = account;
    if (payee !== undefined) data.payee = payee || null;
    if (amountCents !== undefined) data.amountCents = Number(amountCents);
    if (splits !== undefined) { data.splits = splits; data.category = splits.length ? null : (category || null); }
    else if (category !== undefined) data.category = category || null;
    if (frequency !== undefined) data.frequency = frequency;
    if (nextDate !== undefined) data.nextDate = nextDate;
    if (endDate !== undefined) data.endDate = endDate || null;
    if (autoEnter !== undefined) data.autoEnter = !!autoEnter;
    if (reminderDaysBefore !== undefined) data.reminderDaysBefore = Number(reminderDaysBefore);
    if (active !== undefined) data.active = !!active;
    if (notes !== undefined) data.notes = notes;
    if (notifyByEmail !== undefined) data.notifyByEmail = !!notifyByEmail;

    const schedule = await schedules.update(req.params.id, data, access.ownerId);
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    const populated = await schedules.findById(schedule._id, access.ownerId);
    res.json(serialize(populated));
}

async function remove(req, res) {
    const existing = await schedules.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const access = await requireAccountAccess(req, res, existing.account, { write: true });
    if (!access) return;
    await schedules.remove(req.params.id, access.ownerId);
    res.status(204).end();
}

function serializeOccurrence(o) {
    return {
        date: o.occurrenceDate,
        isDue: o.isDue,
        scheduleId: o.schedule._id,
        schedule: {
            id: o.schedule._id,
            name: o.schedule.name,
            payee: o.payee ? { id: o.payee._id, name: o.payee.name } : null,
            category: o.category ? { id: o.category._id, name: o.category.name } : null,
            notes: o.notes,
            amountCents: o.amountCents,
            splits: o.splits
        }
    };
}

// Every not-yet-posted occurrence, across every active schedule on an
// account, out to a cutoff date — powers the register's "upcoming" rows
// (see public/js/register.js). See services/schedules/occurrenceProjection.js.
async function upcoming(req, res) {
    const { account, cutoff } = req.query;
    const access = await requireAccountAccess(req, res, account);
    if (!access) return;
    const cutoffDate = cutoff ? new Date(cutoff) : new Date();
    const asOf = new Date();

    const scheduleDocs = await schedules.listActiveForAccount(account, access.ownerId);
    const occurrences = [];
    for (const schedule of scheduleDocs) {
        const projected = await projectSchedule(schedule, cutoffDate, asOf);
        projected.forEach(o => occurrences.push(o));
    }
    res.json({ occurrences: occurrences.map(serializeOccurrence) });
}

// Editing (or deleting, via skip:true) one occurrence / "this and the next
// N" / "this and every one after" of a recurring schedule, without touching
// the base schedule's own fields (see
// services/schedules/occurrenceOverrides.js for how ranges are kept from
// overlapping as edits/deletes accumulate).
async function setOccurrenceOverride(req, res) {
    const existing = await schedules.findByIdRaw(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const access = await requireAccountAccess(req, res, existing.account, { write: true });
    if (!access) return;

    const { occurrenceDate, scope, count, skip, amountCents, category, payee, notes, splits } = req.body || {};
    if (!occurrenceDate) return res.status(400).json({ error: 'occurrenceDate is required' });
    if (!['single', 'count', 'forever'].includes(scope)) return res.status(400).json({ error: 'scope must be "single", "count", or "forever"' });
    if (scope === 'count' && !(Number(count) > 0)) return res.status(400).json({ error: 'count must be a positive number' });

    const occurrenceCount = scope === 'single' ? 1 : scope === 'count' ? Number(count) : null;
    let entry;
    if (skip) {
        entry = { occurrenceDate: new Date(occurrenceDate), occurrenceCount, skip: true };
    } else {
        if (amountCents === undefined || amountCents === null) return res.status(400).json({ error: 'amountCents is required' });
        const splitError = validateSplits(amountCents, splits);
        if (splitError) return res.status(400).json({ error: splitError });
        entry = {
            occurrenceDate: new Date(occurrenceDate),
            occurrenceCount,
            skip: false,
            amountCents: Number(amountCents),
            category: splits && splits.length ? null : (category || null),
            payee: payee || null,
            notes: notes || '',
            splits: splits || []
        };
    }
    const schedule = await schedules.setOccurrenceOverride(req.params.id, entry, access.ownerId);
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json(serialize(schedule));
}

// Converts a projected (not-yet-posted) occurrence into a real Transaction,
// dated today / on its own scheduled date / on a custom date — then
// advances the schedule's nextDate past it (and any other occurrences that
// are now posted), same as the auto-enter cron does for autoEnter schedules.
async function postOccurrence(req, res) {
    const { occurrenceDate, postTo, customDate } = req.body || {};
    if (!occurrenceDate) return res.status(400).json({ error: 'occurrenceDate is required' });
    if (!['today', 'scheduled', 'custom'].includes(postTo)) return res.status(400).json({ error: 'postTo must be "today", "scheduled", or "custom"' });
    if (postTo === 'custom' && !customDate) return res.status(400).json({ error: 'customDate is required when postTo is "custom"' });

    const schedule = await schedules.findByIdRaw(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    const access = await requireAccountAccess(req, res, schedule.account, { write: true });
    if (!access) return;

    const occDate = new Date(occurrenceDate);
    const override = resolveOverride(schedule.occurrenceOverrides, occDate, schedule.frequency);
    const fields = override || schedule;
    const postDate = postTo === 'today' ? new Date() : postTo === 'scheduled' ? occDate : new Date(customDate);

    const txn = await transactionsDb.create({
        owner: access.ownerId,
        account: schedule.account,
        date: postDate,
        payee: fields.payee,
        amountCents: fields.amountCents,
        category: fields.category,
        splits: fields.splits,
        notes: fields.notes,
        schedule: schedule._id,
        scheduleOccurrenceDate: occDate
    });
    await advanceNextDatePastPosted(schedule);

    const populated = await transactionsDb.findById(txn._id, access.ownerId);
    res.status(201).json({
        id: populated._id,
        account: populated.account,
        date: populated.date,
        payee: populated.payee ? { id: populated.payee._id, name: populated.payee.name } : null,
        amountCents: populated.amountCents,
        category: populated.category ? { id: populated.category._id, name: populated.category.name } : null,
        notes: populated.notes
    });
}

module.exports = { list, create, update, remove, upcoming, setOccurrenceOverride, postOccurrence };
