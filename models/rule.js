const mongoose = require('mongoose');

const CONDITION_FIELDS = ['payee', 'notes', 'amountCents'];
const CONDITION_OPERATORS = ['contains', 'equals', 'startsWith', 'greaterThan', 'lessThan'];
const ACTION_TYPES = ['setCategory', 'renamePayee', 'addTag'];

const conditionSchema = new mongoose.Schema({
    field: { type: String, enum: CONDITION_FIELDS, required: true },
    operator: { type: String, enum: CONDITION_OPERATORS, required: true },
    value: { type: String, required: true, trim: true }
}, { _id: false });

const actionSchema = new mongoose.Schema({
    type: { type: String, enum: ACTION_TYPES, required: true },
    value: { type: String, required: true, trim: true }
}, { _id: false });

const ruleSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    // Lower runs first.
    priority: { type: Number, default: 0 },
    // Halts evaluation of any lower-priority rule once this one matches.
    stopProcessing: { type: Boolean, default: false },
    conditions: { type: [conditionSchema], default: [] },
    actions: { type: [actionSchema], default: [] },
    active: { type: Boolean, default: true }
}, { timestamps: true });

ruleSchema.index({ owner: 1, priority: 1 });

module.exports = mongoose.model('Rule', ruleSchema);
module.exports.CONDITION_FIELDS = CONDITION_FIELDS;
module.exports.CONDITION_OPERATORS = CONDITION_OPERATORS;
module.exports.ACTION_TYPES = ACTION_TYPES;
