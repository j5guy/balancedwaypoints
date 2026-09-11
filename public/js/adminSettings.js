(function () {
    const loggingErrorBox = document.getElementById('logging-error');
    if (!loggingErrorBox) return;
    const loggingSuccessBox = document.getElementById('logging-success');
    const metricsErrorBox = document.getElementById('metrics-error');
    const metricsSuccessBox = document.getElementById('metrics-success');
    const pushgatewayErrorBox = document.getElementById('pushgateway-error');
    const pushgatewaySuccessBox = document.getElementById('pushgateway-success');

    function showError(errorBox, successBox, err) {
        successBox.hidden = true;
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }
    function showSuccess(errorBox, successBox, msg) {
        errorBox.hidden = true;
        successBox.textContent = msg;
        successBox.hidden = false;
    }

    // ── Log export ──
    const destinationSelect = document.getElementById('logging-destination');
    const syslogFields = document.getElementById('logging-syslog-fields');
    const httpFields = document.getElementById('logging-http-fields');

    function updateLoggingFieldVisibility() {
        syslogFields.hidden = destinationSelect.value !== 'syslog';
        httpFields.hidden = destinationSelect.value !== 'http';
    }
    destinationSelect.addEventListener('change', updateLoggingFieldVisibility);

    function applyLoggingSettings(logging) {
        destinationSelect.value = logging.destination;
        document.getElementById('syslog-host').value = logging.syslog.host || '';
        document.getElementById('syslog-port').value = logging.syslog.port;
        document.getElementById('syslog-protocol').value = logging.syslog.protocol;
        document.getElementById('http-url').value = logging.http.url || '';
        document.getElementById('http-auth-header').value = logging.http.authHeader || '';
        updateLoggingFieldVisibility();
    }

    function readLoggingForm() {
        return {
            destination: destinationSelect.value,
            syslogHost: document.getElementById('syslog-host').value.trim(),
            syslogPort: document.getElementById('syslog-port').value,
            syslogProtocol: document.getElementById('syslog-protocol').value,
            httpUrl: document.getElementById('http-url').value.trim(),
            httpAuthHeader: document.getElementById('http-auth-header').value.trim()
        };
    }

    document.getElementById('save-logging-btn').addEventListener('click', async () => {
        try {
            const logging = await window.BWApi.apiFetch('/api/admin/settings/logging', { method: 'PUT', body: readLoggingForm() });
            applyLoggingSettings(logging);
            showSuccess(loggingErrorBox, loggingSuccessBox, 'Logging settings updated.');
        } catch (err) {
            showError(loggingErrorBox, loggingSuccessBox, err);
        }
    });

    // ── Metrics ──
    function applyMetricsSettings(metrics) {
        document.getElementById('metrics-enabled').checked = !!metrics.enabled;
        document.getElementById('metrics-token').value = metrics.token || '';
        document.getElementById('pushgateway-enabled').checked = !!metrics.pushgateway.enabled;
        document.getElementById('pushgateway-url').value = metrics.pushgateway.url || '';
        document.getElementById('pushgateway-interval').value = metrics.pushgateway.intervalSeconds;
    }

    document.getElementById('save-metrics-btn').addEventListener('click', async () => {
        try {
            const metrics = await window.BWApi.apiFetch('/api/admin/settings/metrics', {
                method: 'PUT',
                body: {
                    enabled: document.getElementById('metrics-enabled').checked,
                    token: document.getElementById('metrics-token').value.trim()
                }
            });
            applyMetricsSettings(metrics);
            showSuccess(metricsErrorBox, metricsSuccessBox, 'Metrics settings updated.');
        } catch (err) {
            showError(metricsErrorBox, metricsSuccessBox, err);
        }
    });

    document.getElementById('save-pushgateway-btn').addEventListener('click', async () => {
        try {
            const metrics = await window.BWApi.apiFetch('/api/admin/settings/metrics/pushgateway', {
                method: 'PUT',
                body: {
                    enabled: document.getElementById('pushgateway-enabled').checked,
                    url: document.getElementById('pushgateway-url').value.trim(),
                    intervalSeconds: document.getElementById('pushgateway-interval').value
                }
            });
            applyMetricsSettings(metrics);
            showSuccess(pushgatewayErrorBox, pushgatewaySuccessBox, 'Pushgateway settings updated.');
        } catch (err) {
            showError(pushgatewayErrorBox, pushgatewaySuccessBox, err);
        }
    });

    async function load() {
        try {
            const [logging, metrics] = await Promise.all([
                window.BWApi.apiFetch('/api/admin/settings/logging'),
                window.BWApi.apiFetch('/api/admin/settings/metrics')
            ]);
            applyLoggingSettings(logging);
            applyMetricsSettings(metrics);
        } catch (err) {
            showError(loggingErrorBox, loggingSuccessBox, err);
        }
    }

    load();
})();
