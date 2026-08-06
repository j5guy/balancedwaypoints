const AccountShare = require('../../models/accountShare');
const Account = require('../../models/account');
const User = require('../../models/user');

// The one primitive nearly everything else in Phase 2 builds on. Owner
// check first (no query needed) since that's the overwhelmingly common
// case; only falls through to an AccountShare lookup for someone else's
// account. Returns null (no access at all) rather than throwing — callers
// decide whether that's a 403 or a 404.
async function resolveAccountAccess(accountId, userId) {
    const account = await Account.findById(accountId).exec();
    if (!account) return null;
    if (String(account.owner) === String(userId)) {
        return { account, ownerId: account.owner, role: 'owner' };
    }
    const share = await AccountShare.findOne({ account: accountId, sharedWith: userId }).exec();
    if (!share) return null;
    return { account, ownerId: account.owner, role: share.permission };
}

// Powers the "Managing: [owner]" switcher (services/database/accountShares.js's
// listActingOwners) — true for yourself, or if you hold at least one
// readwrite share on ANY of that owner's accounts. Categories/CategoryGroups/
// Payees/Tags/Rules aren't per-account in the data model, so a readwrite
// share on even one account implies full access to that owner's whole
// categorization system — see the Phase 2 plan's access-tiers table.
async function hasWriteAccessToOwner(userId, targetOwnerId) {
    if (String(userId) === String(targetOwnerId)) return true;
    return AccountShare.exists({ sharedWith: userId, owner: targetOwnerId, permission: 'readwrite' });
}

// True if `userId` holds readwrite (or is the owner) on the SPECIFIC
// account a schedule belongs to — schedules stay account-scoped even
// though categories/payees/rules don't (see the Phase 2 plan).
async function hasWriteAccessToAccount(userId, accountId) {
    const access = await resolveAccountAccess(accountId, userId);
    return !!access && access.role !== 'readonly';
}

const listForAccount = (accountId, ownerId) => AccountShare.find({ account: accountId, owner: ownerId })
    .populate('sharedWith', 'email displayName').sort({ createdAt: 1 }).exec();

// Account ids `userId` holds readwrite on, scoped to accounts owned by
// `targetOwnerId` specifically — used by schedulesController.js to keep
// Schedule CRUD narrower than the owner-wide grant Category/Payee/Rule/Tag
// get once any readwrite share exists (see the Phase 2 plan's access-tiers
// table). Only meaningful for the "acting as someone else" case — callers
// don't need this when `userId === targetOwnerId`.
async function listWritableAccountIds(userId, targetOwnerId) {
    const shares = await AccountShare.find({ sharedWith: userId, owner: targetOwnerId, permission: 'readwrite' }).select('account').exec();
    return new Set(shares.map(s => String(s.account)));
}

// Upserts — re-sharing the same account with the same person just updates
// the permission level rather than erroring on the unique index.
async function create({ accountId, ownerId, sharedWithEmail, permission }) {
    const account = await Account.findOne({ _id: accountId, owner: ownerId }).exec();
    if (!account) return { error: 'not_found' };

    const sharedWith = await User.findOne({ email: sharedWithEmail.toLowerCase().trim() }).exec();
    if (!sharedWith) return { error: 'user_not_found' };
    if (String(sharedWith._id) === String(ownerId)) return { error: 'self' };

    const share = await AccountShare.findOneAndUpdate(
        { account: accountId, sharedWith: sharedWith._id },
        { owner: ownerId, permission },
        { upsert: true, new: true, runValidators: true }
    ).populate('sharedWith', 'email displayName').exec();
    return { share };
}

const update = (shareId, accountId, ownerId, permission) => AccountShare.findOneAndUpdate(
    { _id: shareId, account: accountId, owner: ownerId },
    { permission },
    { new: true, runValidators: true }
).populate('sharedWith', 'email displayName').exec();

const remove = (shareId, accountId, ownerId) => AccountShare.findOneAndDelete({ _id: shareId, account: accountId, owner: ownerId }).exec();

// "Shared with me" — every account (+ its owner's name, + my permission
// level) someone else has shared with the current user. views/accounts/index.ejs's
// second table.
async function listSharedWithMe(userId) {
    const shares = await AccountShare.find({ sharedWith: userId })
        .populate('account')
        .populate('owner', 'email displayName')
        .sort({ createdAt: 1 })
        .exec();
    return shares.filter(s => s.account); // defensive: skip any orphaned row if an account was ever force-deleted without cleaning up its shares
}

// Distinct owners the user holds >=1 readwrite share with — populates the
// "Managing: [dropdown]" control on Budget/Payees/Rules/Schedules.
async function listActingOwners(userId) {
    const shares = await AccountShare.find({ sharedWith: userId, permission: 'readwrite' })
        .populate('owner', 'email displayName')
        .exec();
    const seen = new Map();
    for (const s of shares) {
        if (s.owner) seen.set(String(s.owner._id), s.owner);
    }
    return [...seen.values()];
}

module.exports = {
    resolveAccountAccess, hasWriteAccessToOwner, hasWriteAccessToAccount, listWritableAccountIds,
    listForAccount, create, update, remove, listSharedWithMe, listActingOwners
};
