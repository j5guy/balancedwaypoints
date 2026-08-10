const SimplefinConnection = require('../../models/simplefinConnection');
const Account = require('../../models/account');

const list = (ownerId) => SimplefinConnection.find({ owner: ownerId }).sort({ createdAt: 1 }).exec();
// Deliberately unscoped — the scheduled sync (services/simplefin/simplefinScheduler.js)
// runs across every user's connections in one cron pass, same pattern as
// services/database/schedules.js's findDue for the schedule auto-enter job.
const listAll = () => SimplefinConnection.find({}).exec();
// findOne (not findById) with owner in the filter — mirrors
// services/database/accounts.js's findById so a request for another user's
// connection id resolves to nothing instead of ever loading it.
const findById = (id, ownerId) => SimplefinConnection.findOne({ _id: id, owner: ownerId }).exec();
const create = (data) => SimplefinConnection.create(data);

const updateSyncResult = (id, { status, error }) => SimplefinConnection.findByIdAndUpdate(id, {
    lastSyncAt: new Date(),
    lastSyncStatus: status,
    lastSyncError: error || null
}).exec();

// Unlinks every Account still pointed at this connection (they fall back to
// plain manual accounts, keeping their transaction history) before removing
// the connection itself — an orphaned simplefinConnection reference would
// otherwise break the "synced via SimpleFIN" badge and the next sync run.
const remove = async (id, ownerId) => {
    const connection = await SimplefinConnection.findOne({ _id: id, owner: ownerId }).exec();
    if (!connection) return null;
    await Account.updateMany(
        { owner: ownerId, simplefinConnection: id },
        { simplefinConnection: null, simplefinAccountId: null, simplefinBalanceCents: null, simplefinBalanceDate: null }
    ).exec();
    await SimplefinConnection.findByIdAndDelete(id).exec();
    return connection;
};

module.exports = { list, listAll, findById, create, updateSyncResult, remove };
