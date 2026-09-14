const express = require('express');
const router = express.Router();
const { register } = require('../services/metrics/registry');
const settingsStore = require('../services/settings/store');

// Unconditionally mounted at boot (see server.js) — only what this handler
// returns is gated by settings, so toggling metrics on/off from the Admin
// Settings UI takes effect immediately with no restart.
router.get('/', async (req, res) => {
    const { metrics } = settingsStore.get();
    if (!metrics.enabled) {
        return res.status(404).end();
    }

    if (metrics.token) {
        const auth = req.get('authorization') || '';
        const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (provided !== metrics.token) {
            return res.status(401).end();
        }
    }

    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

module.exports = router;
