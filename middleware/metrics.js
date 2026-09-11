const { httpRequestDuration } = require('../services/metrics/registry');

// Records every request unconditionally — cheap, and keeps history intact
// for whenever an admin turns on GET /metrics later. route falls back to
// the raw path when Express hasn't matched one (e.g. a 404).
module.exports = (req, res, next) => {
    const end = httpRequestDuration.startTimer();
    res.on('finish', () => {
        const route = (req.route && req.baseUrl + req.route.path) || req.path;
        end({ method: req.method, route, status_code: res.statusCode });
    });
    next();
};
