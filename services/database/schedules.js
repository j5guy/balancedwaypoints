const Schedule = require('../../models/schedule');
const { reconcile } = require('../schedules/occurrenceOverrides');

const list = (ownerId) => Schedule.find({ owner: ownerId }).sort({ nextDate: 1 }).populate('account payee category').exec();
const findById = (id, ownerId) => Schedule.findOne({ _id: id, owner: ownerId }).populate('account payee category').exec();

// Deliberately NOT owner-scoped — used only by services/schedules/scheduler.js's
// cron job, which runs outside any request context and is supposed to
// process every user's due schedules in one pass. Each returned document
// already carries its own `owner` (denormalized on the model), so the
// scheduler propagates that onto the Transaction it creates per schedule
// instead of this needing a per-user loop.
const findDue = (asOf = new Date()) => Schedule.find({ active: true, autoEnter: true, nextDate: { $lte: asOf } }).exec();

// Used by the register's "upcoming" projection (see
// services/schedules/occurrenceProjection.js) — populates the override
// entries' own payee/category refs too, since an override can point to a
// different payee/category than the base schedule.
const listActiveForAccount = (accountId, ownerId) => Schedule.find({ owner: ownerId, account: accountId, active: true })
    .populate(['account', 'payee', 'category', 'occurrenceOverrides.payee', 'occurrenceOverrides.category'])
    .exec();

// Raw (unpopulated) fetch — for mutating flows (posting, setting overrides)
// where we want plain ObjectId refs to hand to Transaction.create(), not
// populated documents, and need the real Mongoose document to call .save().
const findRawById = (id, ownerId) => Schedule.findOne({ _id: id, owner: ownerId }).exec();

// Applies a new occurrence override, reconciling it against whatever
// overrides already exist so ranges never overlap (see
// services/schedules/occurrenceOverrides.js). `entry` is a full snapshot:
// { occurrenceDate, occurrenceCount, amountCents, category, payee, notes, splits }.
const setOccurrenceOverride = async (scheduleId, entry, ownerId) => {
    const schedule = await Schedule.findOne({ _id: scheduleId, owner: ownerId }).exec();
    if (!schedule) return null;
    schedule.occurrenceOverrides = reconcile(schedule.occurrenceOverrides, entry, schedule.frequency);
    schedule.markModified('occurrenceOverrides');
    await schedule.save();
    return findById(scheduleId, ownerId);
};

// Deliberately NOT owner-scoped — same reasoning as findDue, used only by
// services/jobs/scheduleReminderEmailJob.js's cron job.
const findNotifiable = (asOf = new Date()) => Schedule.find({
    active: true,
    notifyByEmail: true,
    $expr: {
        $lte: [
            { $subtract: ['$nextDate', { $multiply: ['$reminderDaysBefore', 24 * 60 * 60 * 1000] }] },
            asOf
        ]
    }
}).populate('account payee category').exec();

const create = (data) => Schedule.create(data);
const update = (id, data, ownerId) => Schedule.findOneAndUpdate({ _id: id, owner: ownerId }, data, { new: true, runValidators: true }).exec();
const remove = (id, ownerId) => Schedule.findOneAndDelete({ _id: id, owner: ownerId }).exec();

module.exports = {
    list, findById, findDue, findNotifiable, create, update, remove,
    listActiveForAccount, findRawById, setOccurrenceOverride
};
