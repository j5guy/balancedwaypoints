// Pulls new transactions for every local Account linked to a SimplefinConnection
// and auto-commits them straight to the register — unlike CSV/OFX import
// (controllers/importController.js), which stops at a preview the user
// confirms, a scheduled sync has no one to show a preview to. It leans on
// the same dedupe key convention (services/import/dedupe.js's
// partitionNewRows) and the same rules engine (services/rules/applyRules.js)
// CSV/OFX import already uses, so a rule written for one import path also
// categorizes the other automatically.
const { decrypt } = require('../../utils/secretCrypto');
const { fetchAccounts } = require('./simplefinClient');
const { parseRows } = require('../import/simplefinImport');
const { partitionNewRows } = require('../import/dedupe');
const accountsDb = require('../database/accounts');
const transactionsDb = require('../database/transactions');
const rulesDb = require('../database/rules');
const connectionsDb = require('../database/simplefinConnections');
const { applyRulesResolved } = require('../rules/applyRules');
const logger = require('../../utils/logger');

// First-ever sync for a connection backfills this far; subsequent syncs
// only need to look back far enough to cover any gap since the last run,
// plus a small overlap in case a transaction posts/settles a few days after
// it first appears (SimpleFIN accounts for this with `pending`, but a
// margin here is cheap insurance against a missed edge).
const INITIAL_BACKFILL_DAYS = 90;
const SYNC_OVERLAP_DAYS = 7;

function daysAgo(n) {
    return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// Syncs every locally-linked account under one connection. Always records a
// lastSyncAt/status/error on the connection, even on failure, so the UI can
// show connection health without a separate polling endpoint.
async function syncConnection(connection) {
    const ownerId = connection.owner;
    const linkedAccounts = await accountsDb.findLinkedToSimplefin(connection._id, ownerId);
    if (linkedAccounts.length === 0) {
        await connectionsDb.updateSyncResult(connection._id, { status: 'ok' });
        return { created: 0, warnings: [] };
    }

    const warnings = [];
    let created = 0;

    try {
        const accessUrl = decrypt({ iv: connection.accessUrlIv, ciphertext: connection.accessUrlCiphertext });
        // connection.lastSyncAt tracks the connection as a whole, not each
        // linked account individually — a newly-linked account under a
        // connection that's already synced before would otherwise only get
        // the short overlap window on its first sync and silently miss its
        // backfill. simplefinBalanceDate stays null until an account has
        // synced at least once, so it doubles as a reliable per-account "has
        // this ever synced" flag. Widening the whole request's window when
        // any linked account is on its first sync is harmless for the
        // already-synced ones — the extra rows just get deduped below.
        const anyFirstSync = linkedAccounts.some(a => !a.simplefinBalanceDate);
        const startDate = (connection.lastSyncAt && !anyFirstSync) ? daysAgo(SYNC_OVERLAP_DAYS) : daysAgo(INITIAL_BACKFILL_DAYS);
        const accountIds = linkedAccounts.map(a => a.simplefinAccountId);
        const { accounts: remoteAccounts, errors: topErrors } = await fetchAccounts(accessUrl, { startDate, accountIds });
        warnings.push(...topErrors);

        const remoteById = new Map(remoteAccounts.map(r => [r.id, r]));
        const activeRules = await rulesDb.findActive(ownerId);

        for (const localAccount of linkedAccounts) {
            const remote = remoteById.get(localAccount.simplefinAccountId);
            if (!remote) {
                warnings.push(`"${localAccount.name}": not returned by SimpleFIN this sync (removed at the bridge?)`);
                continue;
            }

            const { rows, errors } = parseRows(remote, localAccount._id);
            warnings.push(...errors.map(e => `"${localAccount.name}": ${e}`));

            const { newRows } = await partitionNewRows(rows, transactionsDb, ownerId);
            let sortOrder = Date.now();
            for (const row of newRows) {
                try {
                    const suggestion = await applyRulesResolved(activeRules, { payee: row.payeeName, notes: row.notes, amountCents: row.amountCents }, ownerId);
                    await transactionsDb.create({
                        owner: ownerId,
                        account: localAccount._id,
                        date: row.date,
                        payee: suggestion.payee ? suggestion.payee._id : null,
                        amountCents: row.amountCents,
                        category: suggestion.categoryId || null,
                        cleared: row.pending ? 'pending' : 'cleared',
                        tags: suggestion.tags.map(t => t._id),
                        notes: row.notes || '',
                        importedId: row.importedId,
                        sortOrder: sortOrder--
                    });
                    created++;
                } catch (err) {
                    logger.error(`SimpleFIN sync: failed to create transaction for "${localAccount.name}" (${row.importedId}): ${err.message}`);
                    warnings.push(`"${localAccount.name}": couldn't save a transaction dated ${row.date.slice(0, 10)} — ${err.message}`);
                }
            }

            if (remote.balance != null) {
                await accountsDb.update(localAccount._id, {
                    simplefinBalanceCents: Math.round(parseFloat(remote.balance) * 100),
                    simplefinBalanceDate: remote['balance-date'] ? new Date(remote['balance-date'] * 1000) : new Date()
                }, ownerId);
            }
        }

        await connectionsDb.updateSyncResult(connection._id, { status: 'ok', error: warnings.length ? warnings.join('; ') : null });
        return { created, warnings };
    } catch (err) {
        logger.error(`SimpleFIN sync failed for connection ${connection._id}: ${err.message}`);
        await connectionsDb.updateSyncResult(connection._id, { status: 'error', error: err.message });
        throw err;
    }
}

module.exports = { syncConnection };
