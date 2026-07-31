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

module.exports = { forMonth, upToMonth, assign };
