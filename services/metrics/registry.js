const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Always collected regardless of whether GET /metrics is currently exposed —
// only exposure is gated by settings (see routes/metrics.js), not collection.
const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register]
});

module.exports = { register, httpRequestDuration };
