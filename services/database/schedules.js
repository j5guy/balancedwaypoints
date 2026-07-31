const Schedule = require('../../models/schedule');

const list = () => Schedule.find().sort({ nextDate: 1 }).populate('account payee category').exec();
const findById = (id) => Schedule.findById(id).populate('account payee category').exec();
const findDue = (asOf = new Date()) => Schedule.find({ active: true, autoEnter: true, nextDate: { $lte: asOf } }).exec();

// Candidates for services/jobs/scheduleReminderEmailJob.js — active,
// opted-in schedules whose OWN reminder window has arrived (reminderDaysBefore
// varies per schedule, hence the $expr comparing two fields rather than a
// fixed cutoff). Callers still need to filter out ones already notified for
// this exact occurrence — see lastNotifiedForDate on the model — since that
// dedup is cheaper done in JS than as a second $expr clause here.
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
const update = (id, data) => Schedule.findByIdAndUpdate(id, data, { new: true, runValidators: true }).exec();
const remove = (id) => Schedule.findByIdAndDelete(id).exec();

module.exports = { list, findById, findDue, findNotifiable, create, update, remove };
