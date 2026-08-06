// Runs a candidate transaction (plain fields, not yet a Transaction doc)
// through the active, priority-ordered ruleset, returning suggested field
// changes. Used at CSV/OFX import preview time and via a manual "apply
// rules" action on an existing transaction — never runs automatically on
// save, so a bad rule can't silently mangle the register.
const payeesDb = require('../database/payees');
const tagsDb = require('../database/tags');

function conditionMatches(condition, candidate) {
    const { field, operator, value } = condition;
    if (field === 'amountCents') {
        const num = Number(value);
        const amount = candidate.amountCents;
        if (operator === 'equals') return amount === num;
        if (operator === 'greaterThan') return amount > num;
        if (operator === 'lessThan') return amount < num;
        return false;
    }

    const haystack = String(candidate[field] || '').toLowerCase();
    const needle = value.toLowerCase();
    if (operator === 'contains') return haystack.includes(needle);
    if (operator === 'equals') return haystack === needle;
    if (operator === 'startsWith') return haystack.startsWith(needle);
    return false;
}

function ruleMatches(rule, candidate) {
    if (rule.conditions.length === 0) return false;
    return rule.conditions.every(c => conditionMatches(c, candidate));
}

// candidate: { payee: <name string>, notes, amountCents }
// Returns { categoryId, payeeName, tagNames: [] } — null fields mean "no
// suggestion", left for the caller/UI to fill in some other way.
async function applyRules(rules, candidate) {
    const result = { categoryId: null, payeeName: candidate.payee || null, tagNames: [] };

    for (const rule of rules) {
        if (!ruleMatches(rule, { ...candidate, payee: result.payeeName })) continue;

        for (const action of rule.actions) {
            if (action.type === 'setCategory') result.categoryId = action.value;
            if (action.type === 'renamePayee') result.payeeName = action.value;
            if (action.type === 'addTag') result.tagNames.push(action.value);
        }

        if (rule.stopProcessing) break;
    }

    return result;
}

// Convenience wrapper that also resolves the payee name / tag names to docs,
// for callers that want ready-to-save references.
async function applyRulesResolved(rules, candidate, ownerId) {
    const result = await applyRules(rules, candidate);
    const payee = result.payeeName ? await payeesDb.findOrCreateByName(result.payeeName, ownerId) : null;
    const tags = await Promise.all(result.tagNames.map(name => tagsDb.findOrCreateByName(name, ownerId)));
    return { categoryId: result.categoryId, payee, tags: tags.filter(Boolean) };
}

module.exports = { applyRules, applyRulesResolved, ruleMatches, conditionMatches };
