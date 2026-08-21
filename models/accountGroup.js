const mongoose = require('mongoose');

// Purely organizational — groups accounts on the Accounts page (collapsible
// sections there, see public/js/accounts.js) the same way CategoryGroup
// groups categories on the Budget page. Never affects balance math or
// envelope budgeting, which both key off individual accounts regardless of
// which group (if any) they're in.
const accountGroupSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

accountGroupSchema.index({ owner: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('AccountGroup', accountGroupSchema);
