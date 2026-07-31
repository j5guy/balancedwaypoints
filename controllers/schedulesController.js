const schedules = require('../services/database/schedules');
const transactionsDb = require('../services/database/transactions');
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

async function list(req, res) {
    const items = await schedules.list();
    res.json({ schedules: items.map(serialize) });
}

async function create(req, res) {
    const { name, account, payee, amountCents, category, splits, frequency, nextDate, endDate, autoEnter, reminderDaysBefore, notes, notifyByEmail } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'name is required' });
    if (!account) return res.status(400).json({ error: 'account is required' });
    if (amountCents === undefined) return res.status(400).json({ error: 'amountCents is required' });
    if (!nextDate) return res.status(400).json({ error: 'nextDate is required' });
    if (frequency && frequency.unit && !FREQUENCY_UNITS.includes(frequency.unit)) return res.status(400).json({ error: 'Invalid frequency unit' });
    const splitError = validateSplits(amountCents, splits);
    if (splitError) return res.status(400).json({ error: splitError });

    const schedule = await schedules.create({
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
    const populated = await schedules.findById(schedule._id);
    res.status(201).json(serialize(populated));
}

async function update(req, res) {
    const { name, account, payee, amountCents, category, splits, frequency, nextDate, endDate, autoEnter, reminderDaysBefore, active, notes, notifyByEmail } = req.body || {};
    if (frequency && frequency.unit && !FREQUENCY_UNITS.includes(frequency.unit)) return res.status(400).json({ error: 'Invalid frequency unit' });

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

    const schedule = await schedules.update(req.params.id, data);
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    const populated = await schedules.findById(schedule._id);
    res.json(serialize(populated));
}

async function remove(req, res) {
    const schedule = await schedules.remove(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Not found' });
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
    if (!account) return res.status(400).json({ error: 'account is required' });
    const cutoffDate = cutoff ? new Date(cutoff) : new Date();
    const asOf = new Date();

    const scheduleDocs = await schedules.listActiveForAccount(account);
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
    const schedule = await schedules.setOccurrenceOverride(req.params.id, entry);
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

    const schedule = await schedules.findRawById(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Not found' });

    const occDate = new Date(occurrenceDate);
    const override = resolveOverride(schedule.occurrenceOverrides, occDate, schedule.frequency);
    const fields = override || schedule;
    const postDate = postTo === 'today' ? new Date() : postTo === 'scheduled' ? occDate : new Date(customDate);

    const txn = await transactionsDb.create({
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

    const populated = await transactionsDb.findById(txn._id);
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
