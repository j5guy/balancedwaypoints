const Schedule = require('../../models/schedule');
const { reconcile } = require('../schedules/occurrenceOverrides');
const { encryptNotes, decryptNotes, decryptSplitsInPlace, encryptSplitsForWrite, decryptOverridesInPlace } = require('./notesCrypto');
const { decorate: decoratePayee } = require('./payees');

// notes/splits[].notes, and occurrenceOverrides[].notes/splits[].notes, are
// encrypted at rest (AES-256-GCM, see utils/secretCrypto.js and
// services/database/notesCrypto.js) — decorate() attaches plaintext back
// onto the in-memory document. Also decrypts a populated `payee` ref (base
// schedule and, when listActiveForAccount() populated them too, each
// occurrence override's own payee) — populate() only pulls the stored
// nameIv/nameCiphertext, it doesn't run it through payees.js's own decorate().
function decorate(doc) {
    if (!doc) return doc;
    doc.notes = decryptNotes(doc);
    decryptSplitsInPlace(doc.splits);
    decryptOverridesInPlace(doc.occurrenceOverrides);
    if (doc.payee && doc.payee.nameIv !== undefined) decoratePayee(doc.payee);
    (doc.occurrenceOverrides || []).forEach((o) => {
        if (o.payee && o.payee.nameIv !== undefined) decoratePayee(o.payee);
    });
    return doc;
}
function decorateAll(docs) { docs.forEach(decorate); return docs; }

// Builds the fields to write from a payload that may carry notes/splits
// (create sends both, update only whichever were actually submitted).
function prepareWrite({ notes, splits, ...rest }) {
    const out = { ...rest };
    if (notes !== undefined) Object.assign(out, encryptNotes(notes));
    if (splits !== undefined) out.splits = encryptSplitsForWrite(splits);
    return out;
}

const list = async (ownerId) => decorateAll(await Schedule.find({ owner: ownerId }).sort({ nextDate: 1 }).populate('account payee category transferAccount autopayFromAccount').exec());
const findById = async (id, ownerId) => decorate(await Schedule.findOne({ _id: id, owner: ownerId }).populate('account payee category transferAccount autopayFromAccount').exec());

// Deliberately NOT owner-scoped — used only by services/schedules/scheduler.js's
// cron job, which runs outside any request context and is supposed to
// process every user's due schedules in one pass. Each returned document
// already carries its own `owner` (denormalized on the model), so the
// scheduler propagates that onto the Transaction it creates per schedule
// instead of this needing a per-user loop.
const findDue = async (asOf = new Date()) => decorateAll(await Schedule.find({ active: true, autoEnter: true, nextDate: { $lte: asOf } }).exec());

// Used by the register's "upcoming" projection (see
// services/schedules/occurrenceProjection.js) — populates the override
// entries' own payee/category refs too, since an override can point to a
// different payee/category than the base schedule. Matches `account` OR
// `transferAccount` — a transfer schedule needs to show as an upcoming row
// in BOTH accounts' registers, same as a posted transfer creates a real
// Transaction on both sides (see controllers/schedulesController.js's
// upcoming(), which normalizes the sign and picks the right counterpart
// account depending on which side matched).
const listActiveForAccount = async (accountId, ownerId) => decorateAll(await Schedule.find({
    owner: ownerId,
    active: true,
    $or: [{ account: accountId }, { transferAccount: accountId }]
})
    .populate(['account', 'payee', 'category', 'transferAccount', 'autopayFromAccount', 'occurrenceOverrides.payee', 'occurrenceOverrides.category'])
    .exec());

// Unscoped — used to discover a schedule's own `account` before access has
// been resolved (mirrors services/database/transactions.js's findByIdRaw).
// Also doubles as the raw fetch mutating flows (posting, setting overrides)
// need — plain ObjectId refs to hand to Transaction.create(), not populated
// documents, and the real Mongoose document to call .save() on. Never
// returned to a client without an access check first.
const findByIdRaw = async (id) => decorate(await Schedule.findById(id).exec());

// Applies a new occurrence override, reconciling it against whatever
// overrides already exist so ranges never overlap (see
// services/schedules/occurrenceOverrides.js). `entry` is a full snapshot:
// { occurrenceDate, occurrenceCount, amountCents, category, payee, notes, splits }.
// Deliberately fetched raw (not decorate()'d) — reconcile() only ever
// carries forward EXISTING overrides' own stored fields untouched when
// splitting/truncating a date range, so it never needs their notes/splits
// decrypted; only the new `entry` (fresh plaintext from the controller)
// needs encrypting before it's added to the array.
const setOccurrenceOverride = async (scheduleId, entry, ownerId) => {
    const schedule = await Schedule.findOne({ _id: scheduleId, owner: ownerId }).exec();
    if (!schedule) return null;
    const { notes, splits, ...rest } = entry;
    const encryptedEntry = { ...rest, ...encryptNotes(notes), splits: encryptSplitsForWrite(splits) };
    schedule.occurrenceOverrides = reconcile(schedule.occurrenceOverrides, encryptedEntry, schedule.frequency);
    schedule.markModified('occurrenceOverrides');
    await schedule.save();
    return findById(scheduleId, ownerId);
};

// Deliberately NOT owner-scoped — same reasoning as findDue, used only by
// services/jobs/scheduleReminderEmailJob.js's cron job.
const findNotifiable = async (asOf = new Date()) => decorateAll(await Schedule.find({
    active: true,
    notifyByEmail: true,
    $expr: {
        $lte: [
            { $subtract: ['$nextDate', { $multiply: ['$reminderDaysBefore', 24 * 60 * 60 * 1000] }] },
            asOf
        ]
    }
}).populate('account payee category transferAccount autopayFromAccount').exec());

const create = async (data) => decorate(await Schedule.create(prepareWrite(data)));
const update = async (id, data, ownerId) => decorate(await Schedule.findOneAndUpdate({ _id: id, owner: ownerId }, prepareWrite(data), { new: true, runValidators: true }).exec());
const remove = (id, ownerId) => Schedule.findOneAndDelete({ _id: id, owner: ownerId }).exec();

module.exports = {
    list, findById, findDue, findNotifiable, create, update, remove,
    listActiveForAccount, findByIdRaw, setOccurrenceOverride
};
