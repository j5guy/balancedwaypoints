const licenseDb = require('../services/database/license');
const gate = require('../services/licensing/gate');
const client = require('../services/licensing/client');
const logger = require('../utils/logger');

async function show(req, res) {
    const cached = await licenseDb.getCachedLicense();
    res.render('license/enter', {
        title: 'License',
        license: cached,
        active: gate.isLicenseActive(cached),
        error: req.query.error || null
    });
}

async function activate(req, res) {
    // Not uppercased here (unlike a plain AWP-XXXX key, which the licensing
    // service itself normalizes on lookup) — an offline token's base64url
    // payload/signature are case-sensitive, so folding case client-side
    // would silently corrupt one. See services/licensing/offline.js.
    const key = String((req.body || {}).key || '').trim();
    if (!key) return res.status(400).json({ error: 'Enter a license key' });
    try {
        const result = await gate.activate(key);
        res.json({ ok: true, license: result });
    } catch (err) {
        logger.error('License activate failed: ' + err.message + (err.cause ? ` (${err.cause})` : ''));
        res.status(400).json({ error: err.message });
    }
}

// Kicks off a Stripe Checkout session for a Lifetime purchase and redirects
// the browser straight to it.
async function checkout(req, res) {
    try {
        const { url } = await client.startCheckout();
        if (!url) throw new Error('Checkout is not available right now');
        res.redirect(url);
    } catch (err) {
        logger.error('License checkout failed: ' + err.message);
        res.redirect('/license?error=' + encodeURIComponent('Purchase is not available right now — please try again later.'));
    }
}

module.exports = { show, activate, checkout };
