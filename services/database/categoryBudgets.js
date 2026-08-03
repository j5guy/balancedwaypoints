const CategoryBudget = require('../../models/categoryBudget');

const forMonth = (month) => CategoryBudget.find({ month }).exec();

// All rows up to and including a given month, per category — used to
// compute rolling balances (services/budget/envelope.js) without needing to
// re-scan every month from the beginning each time a later one is requested.
const upToMonth = (month) => CategoryBudget.find({ month: { $lte: month } }).exec();

const assign = (categoryId, month, assignedCents) => CategoryBudget.findOneAndUpdate(
    { category: categoryId, month },
    { assignedCents },
    { upsert: true, new: true, runValidators: true }
).exec();

// Copies every category's assignedCents from fromMonth into toMonth —
// upserts per category, so a category with no row yet in toMonth gets one
// created, and one that already has an assignment there gets overwritten.
// Categories with nothing assigned in fromMonth are left untouched in
// toMonth (there's nothing to copy for them).
const copyMonth = async (fromMonth, toMonth) => {
    const rows = await forMonth(fromMonth);
    await Promise.all(rows.map(r => assign(r.category, toMonth, r.assignedCents)));
    return rows.length;
};

module.exports = { forMonth, upToMonth, assign, copyMonth };
