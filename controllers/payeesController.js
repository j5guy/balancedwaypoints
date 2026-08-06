const payees = require('../services/database/payees');

function serialize(payee) {
    return {
        id: payee._id,
        name: payee.name,
        transferAccount: payee.transferAccount ? payee.transferAccount._id || payee.transferAccount : null,
        defaultCategory: payee.defaultCategory ? payee.defaultCategory._id || payee.defaultCategory : null,
        address: payee.address || '',
        phone: payee.phone || '',
        accountNumber: payee.accountNumber || ''
    };
}

async function list(req, res) {
    const items = await payees.list(req.session.userId);
    res.json({ payees: items.map(serialize) });
}

async function create(req, res) {
    const name = String((req.body || {}).name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { transferAccount, defaultCategory, address, phone, accountNumber } = req.body || {};

    try {
        const payee = await payees.create({
            owner: req.session.userId,
            name,
            transferAccount: transferAccount || null,
            defaultCategory: defaultCategory || null,
            address: address || '',
            phone: phone || '',
            accountNumber: accountNumber || ''
        });
        res.status(201).json(serialize(payee));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A payee with that name already exists' });
        throw err;
    }
}

async function update(req, res) {
    const { name, transferAccount, defaultCategory, address, phone, accountNumber } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (transferAccount !== undefined) data.transferAccount = transferAccount || null;
    if (defaultCategory !== undefined) data.defaultCategory = defaultCategory || null;
    if (address !== undefined) data.address = address;
    if (phone !== undefined) data.phone = phone;
    if (accountNumber !== undefined) data.accountNumber = accountNumber;

    try {
        const payee = await payees.update(req.params.id, data, req.session.userId);
        if (!payee) return res.status(404).json({ error: 'Not found' });
        res.json(serialize(payee));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: 'A payee with that name already exists' });
        throw err;
    }
}

async function remove(req, res) {
    const payee = await payees.remove(req.params.id, req.session.userId);
    if (!payee) return res.status(409).json({ error: 'Payee is used by existing transactions and cannot be deleted' });
    res.status(204).end();
}

module.exports = { list, create, update, remove };
