const connectionsDb = require('../services/database/simplefinConnections');
const accountsDb = require('../services/database/accounts');
const { ACCOUNT_TYPES } = require('../models/account');
const { claimAccessUrl, fetchAccounts, SimplefinError } = require('../services/simplefin/simplefinClient');
const { syncConnection } = require('../services/simplefin/syncService');
const { encrypt, decrypt } = require('../utils/secretCrypto');
const logger = require('../utils/logger');

// Never includes the access URL (encrypted or not) — the client has no
// legitimate use for it once a connection is saved.
function serializeConnection(connection, linkedAccounts) {
    return {
        id: connection._id,
        label: connection.label,
        createdAt: connection.createdAt,
        lastSyncAt: connection.lastSyncAt,
        lastSyncStatus: connection.lastSyncStatus,
        lastSyncError: connection.lastSyncError,
        linkedAccounts: (linkedAccounts || []).map(a => ({ id: a._id, name: a.name, simplefinAccountId: a.simplefinAccountId }))
    };
}

function serializeRemoteAccount(remote) {
    return {
        id: remote.id,
        name: remote.name,
        org: remote.org ? remote.org.name : null,
        currency: remote.currency || null,
        balanceCents: remote.balance != null ? Math.round(parseFloat(remote.balance) * 100) : null
    };
}

async function list(req, res) {
    const [connections, accounts] = await Promise.all([
        connectionsDb.list(req.session.userId),
        accountsDb.list(req.session.userId)
    ]);
    const result = connections.map(c => serializeConnection(
        c,
        accounts.filter(a => a.simplefinConnection && String(a.simplefinConnection) === String(c._id))
    ));
    res.json({ connections: result });
}

// Claims the one-time setup token, saves the resulting access URL
// (encrypted), and immediately fetches the remote account list once so the
// UI can offer account-linking without a second round trip. That initial
// fetch failing doesn't fail the whole request — the connection is already
// saved and usable, the user just needs to revisit linking (GET
// /:id/remote-accounts) if the bridge was briefly unavailable.
async function create(req, res) {
    const { setupToken, label } = req.body || {};
    if (!String(setupToken || '').trim()) return res.status(400).json({ error: 'setupToken is required' });

    let accessUrl;
    try {
        accessUrl = await claimAccessUrl(setupToken);
    } catch (err) {
        if (err instanceof SimplefinError) return res.status(400).json({ error: err.message });
        throw err;
    }

    const { iv, ciphertext } = encrypt(accessUrl);
    const connection = await connectionsDb.create({
        owner: req.session.userId,
        label: String(label || '').trim() || 'Bank connection',
        accessUrlIv: iv,
        accessUrlCiphertext: ciphertext
    });

    let remoteAccounts = [];
    try {
        const { accounts } = await fetchAccounts(accessUrl);
        remoteAccounts = accounts.map(serializeRemoteAccount);
    } catch (err) {
        logger.error(`SimpleFIN: initial account fetch failed for connection ${connection._id}: ${err.message}`);
    }

    res.status(201).json({ connection: serializeConnection(connection, []), remoteAccounts });
}

// Live re-fetch of the remote account list — used both to (re)populate the
// linking UI and to notice a new account added at the bridge after the
// connection was first set up.
async function remoteAccountsFor(req, res) {
    const connection = await connectionsDb.findById(req.params.id, req.session.userId);
    if (!connection) return res.status(404).json({ error: 'Not found' });

    try {
        const accessUrl = decrypt({ iv: connection.accessUrlIv, ciphertext: connection.accessUrlCiphertext });
        const { accounts, errors } = await fetchAccounts(accessUrl);
        res.json({ remoteAccounts: accounts.map(serializeRemoteAccount), errors });
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
}

// Body: { simplefinAccountId, accountId } to link an existing Account, or
// { simplefinAccountId, newAccount: { name, type } } to create one.
async function link(req, res) {
    const connection = await connectionsDb.findById(req.params.id, req.session.userId);
    if (!connection) return res.status(404).json({ error: 'Not found' });

    const { simplefinAccountId, accountId, newAccount } = req.body || {};
    if (!String(simplefinAccountId || '').trim()) return res.status(400).json({ error: 'simplefinAccountId is required' });

    let targetAccountId = accountId;
    if (!targetAccountId) {
        const name = String((newAccount && newAccount.name) || '').trim();
        if (!name) return res.status(400).json({ error: 'accountId or newAccount.name is required' });
        if (newAccount.type && !ACCOUNT_TYPES.includes(newAccount.type)) return res.status(400).json({ error: 'Invalid account type' });

        const created = await accountsDb.create({
            owner: req.session.userId,
            name,
            type: newAccount.type || 'checking',
            startingBalanceCents: 0
        });
        targetAccountId = created._id;
    }

    const account = await accountsDb.update(targetAccountId, {
        simplefinConnection: connection._id,
        simplefinAccountId
    }, req.session.userId);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    res.json({ id: account._id, name: account.name, simplefinAccountId: account.simplefinAccountId });
}

async function syncNow(req, res) {
    const connection = await connectionsDb.findById(req.params.id, req.session.userId);
    if (!connection) return res.status(404).json({ error: 'Not found' });

    try {
        const result = await syncConnection(connection);
        res.json(result);
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
}

async function remove(req, res) {
    const connection = await connectionsDb.remove(req.params.id, req.session.userId);
    if (!connection) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
}

module.exports = { list, create, remoteAccountsFor, link, syncNow, remove };
