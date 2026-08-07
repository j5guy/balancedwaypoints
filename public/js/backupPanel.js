// Shared behind Admin > Backups (site-wide) and My Account > Backups
// (personal) — both pages render the identical set of element ids
// (backup-destination, backup-frequency, etc.), just against a different
// API prefix and status-message elements. See public/js/adminBackups.js /
// accountBackups.js for the two one-line callers.
(function (root) {
    function formatBytes(bytes) {
        if (!Number.isFinite(bytes)) return '—';
        const units = ['B', 'KB', 'MB', 'GB'];
        let value = bytes;
        let i = 0;
        while (value >= 1024 && i < units.length - 1) {
            value /= 1024;
            i++;
        }
        return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function init(apiPrefix, opts) {
        const options = Object.assign({ errorId: 'backup-error', successId: 'backup-success', scopeLabel: 'all current data' }, opts);
        const errorBox = document.getElementById(options.errorId);
        if (!errorBox) return;
        const successBox = document.getElementById(options.successId);

        function showError(err) {
            successBox.hidden = true;
            errorBox.textContent = (err && err.message) || 'Something went wrong';
            errorBox.hidden = false;
        }
        function showSuccess(msg) {
            errorBox.hidden = true;
            successBox.textContent = msg;
            successBox.hidden = false;
        }

        const dayOfWeekGroup = document.getElementById('backup-day-of-week-group');
        function syncFrequencyUi() {
            dayOfWeekGroup.style.display = document.getElementById('backup-frequency').value === 'weekly' ? '' : 'none';
        }
        document.getElementById('backup-frequency').addEventListener('change', syncFrequencyUi);

        function applySettings(cfg) {
            document.getElementById('backup-default-destination').textContent = cfg.defaultDestination;
            document.getElementById('backup-destination').value = cfg.destination || '';
            document.getElementById('backup-destination').placeholder = cfg.defaultDestination;
            document.getElementById('backup-frequency').value = cfg.frequency;
            document.getElementById('backup-time').value = cfg.time;
            document.getElementById('backup-day-of-week').value = String(cfg.dayOfWeek);
            document.getElementById('backup-retention').value = cfg.retentionCount;
            syncFrequencyUi();
        }

        function readSettingsForm() {
            return {
                destination: document.getElementById('backup-destination').value.trim(),
                frequency: document.getElementById('backup-frequency').value,
                time: document.getElementById('backup-time').value,
                dayOfWeek: parseInt(document.getElementById('backup-day-of-week').value, 10),
                retentionCount: parseInt(document.getElementById('backup-retention').value, 10)
            };
        }

        async function loadSettings() {
            try {
                const cfg = await window.BWApi.apiFetch(`${apiPrefix}/settings/backup`);
                applySettings(cfg);
            } catch (err) {
                showError(err);
            }
        }

        document.getElementById('save-backup-settings-btn').addEventListener('click', async () => {
            try {
                const cfg = await window.BWApi.apiFetch(`${apiPrefix}/settings/backup`, { method: 'PUT', body: readSettingsForm() });
                applySettings(cfg);
                showSuccess('Backup settings saved.');
            } catch (err) {
                showError(err);
            }
        });

        document.getElementById('check-destination-btn').addEventListener('click', async () => {
            const statusEl = document.getElementById('destination-check-status');
            statusEl.textContent = 'Checking…';
            try {
                const destination = document.getElementById('backup-destination').value.trim();
                const result = await window.BWApi.apiFetch(`${apiPrefix}/settings/backup/check`, { method: 'POST', body: { destination } });
                statusEl.textContent = `${result.ok ? '✓' : '✗'} ${result.message} (${result.destination})`;
            } catch (err) {
                statusEl.textContent = `✗ ${err.message || 'Check failed'}`;
            }
        });

        document.getElementById('run-backup-btn').addEventListener('click', async () => {
            const btn = document.getElementById('run-backup-btn');
            btn.disabled = true;
            try {
                const result = await window.BWApi.apiFetch(`${apiPrefix}/backup/run`, { method: 'POST' });
                showSuccess(`Backup complete: ${result.file} (${formatBytes(result.sizeBytes)}).`);
                await Promise.all([loadFiles(), loadRuns()]);
            } catch (err) {
                showError(err);
            } finally {
                btn.disabled = false;
            }
        });

        function fileRow(file) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${file.name}</td>
                <td>${formatBytes(file.sizeBytes)}</td>
                <td>${new Date(file.modifiedAt).toLocaleString()}</td>
                <td class="row-actions">
                    <a class="btn btn-secondary btn-sm" href="${apiPrefix}/backup/files/${encodeURIComponent(file.name)}/download">Download</a>
                    <button type="button" class="btn btn-danger btn-sm" data-restore>Restore</button>
                    <button type="button" class="btn btn-danger btn-sm" data-delete>Delete</button>
                </td>
            `;
            tr.querySelector('[data-restore]').addEventListener('click', async () => {
                if (!confirm(`Restore from "${file.name}"? This replaces ${options.scopeLabel} and can't be undone.`)) return;
                try {
                    const result = await window.BWApi.apiFetch(`${apiPrefix}/backup/files/${encodeURIComponent(file.name)}/restore`, { method: 'POST' });
                    showSuccess(`Restored ${result.restoredCollections} collection(s) from ${file.name}.`);
                    await loadRuns();
                } catch (err) {
                    showError(err);
                }
            });
            tr.querySelector('[data-delete]').addEventListener('click', async () => {
                if (!confirm(`Delete backup file "${file.name}"?`)) return;
                try {
                    await window.BWApi.apiFetch(`${apiPrefix}/backup/files/${encodeURIComponent(file.name)}`, { method: 'DELETE' });
                    tr.remove();
                } catch (err) {
                    showError(err);
                }
            });
            return tr;
        }

        async function loadFiles() {
            try {
                const result = await window.BWApi.apiFetch(`${apiPrefix}/backup/files`);
                document.getElementById('files-destination').textContent = result.destination;
                const tbody = document.getElementById('files-tbody');
                tbody.innerHTML = '';
                result.files.forEach((f) => tbody.appendChild(fileRow(f)));
            } catch (err) {
                showError(err);
            }
        }

        function runRow(run) {
            const tr = document.createElement('tr');
            const detail = run.status === 'error' ? run.error : (run.file || `${run.action} ok`);
            tr.innerHTML = `
                <td>${new Date(run.startedAt).toLocaleString()}</td>
                <td>${run.action}</td>
                <td>${run.trigger}</td>
                <td>${run.status === 'success' ? '✓ success' : '✗ error'}</td>
                <td>${detail}</td>
            `;
            return tr;
        }

        async function loadRuns() {
            try {
                const { runs } = await window.BWApi.apiFetch(`${apiPrefix}/backup/runs`);
                const tbody = document.getElementById('runs-tbody');
                tbody.innerHTML = '';
                runs.forEach((r) => tbody.appendChild(runRow(r)));
            } catch (err) {
                showError(err);
            }
        }

        document.getElementById('restore-upload-btn').addEventListener('click', async () => {
            const input = document.getElementById('restore-upload-input');
            if (!input.files.length) return showError(new Error('Choose a backup file first'));
            if (!confirm(`Restore from this file? This replaces ${options.scopeLabel} and can't be undone.`)) return;

            const formData = new FormData();
            formData.append('file', input.files[0]);
            try {
                const result = await window.BWApi.apiUpload(`${apiPrefix}/backup/restore-upload`, formData);
                showSuccess(`Restored ${result.restoredCollections} collection(s) from the uploaded file.`);
                input.value = '';
                await loadRuns();
            } catch (err) {
                showError(err);
            }
        });

        loadSettings();
        loadFiles();
        loadRuns();
    }

    root.BWBackupPanel = { init };
})(window);
