const schedules = require('../services/database/schedules');
const { FREQUENCY_UNITS } = require('../models/schedule');

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

module.exports = { list, create, update, remove };
