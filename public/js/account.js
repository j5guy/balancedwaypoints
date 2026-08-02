(function () {
    const errorBox = document.getElementById('account-error');
    if (!errorBox) return;
    const successBox = document.getElementById('account-success');

    // Every color the app themes, grouped just for a readable layout — the
    // field keys must match utils/themeColorFields.js exactly (that's the
    // server-side source of truth this duplicates; client-side code can't
    // require() it without a build step, so keep the two in sync by hand).
    const THEME_FIELD_GROUPS = [
        { title: 'Text', fields: [
            ['textPrimary', 'Primary text'],
            ['textSecondary', 'Secondary text'],
            ['textMuted', 'Muted text']
        ] },
        { title: 'Backgrounds', fields: [
            ['bgBase', 'Page background'],
            ['bgSecondary', 'Secondary background'],
            ['bgCard', 'Card background'],
            ['bgHover', 'Hover background']
        ] },
        { title: 'Borders', fields: [
            ['border', 'Border'],
            ['borderLight', 'Light border']
        ] },
        { title: 'Accent', fields: [
            ['accent', 'Accent (buttons, highlights)']
        ] },
        { title: 'Navigation', fields: [
            ['navBg', 'Nav background'],
            ['navText', 'Nav text']
        ] }
    ];
    const THEME_FIELDS = THEME_FIELD_GROUPS.flatMap(g => g.fields.map(([key]) => key));

    // Just a starting point shown in the color pickers when a field has no
    // stored override yet — <input type="color"> can't represent "unset",
    // it always shows some real color. Only fields the user actually edits
    // (or explicitly resets) get sent on save — see themeOverrides below —
    // so merely opening this page and hitting Save can't silently lock in
    // these defaults as if they were a deliberate choice. Matches
    // public/scss/layout/_base.scss's compiled defaults (a couple are
    // approximated where the source SCSS derives them via color.adjust()
    // rather than a literal hex).
    const THEME_DEFAULTS = {
        light: {
            bgBase: '#F6F5F1', bgSecondary: '#FFFFFF', bgCard: '#FFFFFF', bgHover: '#ECEAE3',
            border: '#DEDBD1', borderLight: '#EAE7DE',
            textPrimary: '#22282A', textSecondary: '#5C6467', textMuted: '#666F72',
            accent: '#1B6E6E',
            navBg: '#FFFFFF', navText: '#454D50'
        },
        dark: {
            bgBase: '#171B1C', bgSecondary: '#1D2224', bgCard: '#212728', bgHover: '#2A3132',
            border: '#343C3E', borderLight: '#2A3132',
            textPrimary: '#EDEFEE', textSecondary: '#C7CDCB', textMuted: '#8D9698',
            accent: '#2A8F8F',
            navBg: '#212728', navText: '#C7CDCB'
        }
    };
    // Only holds an entry for a field once it's been touched (edited or
    // reset) this session, or already had a stored override on load — see
    // applyAccount. That's what lets Save send just the fields that
    // actually changed instead of everything currently shown.
    let themeOverrides = { light: {}, dark: {} };

    // Built once at load — the color <input>/<label> pairs for both theme
    // columns, grouped under THEME_FIELD_GROUPS' section titles.
    function buildThemeFieldsUI() {
        ['light', 'dark'].forEach((theme) => {
            const container = document.getElementById(`theme-fields-${theme}`);
            THEME_FIELD_GROUPS.forEach((group) => {
                const title = document.createElement('div');
                title.className = 'theme-field-group-title';
                title.textContent = group.title;
                container.appendChild(title);

                group.fields.forEach(([field, label]) => {
                    const row = document.createElement('div');
                    row.className = 'theme-color-field';
                    row.innerHTML = `
                        <label for="theme-${theme}-${field}">${label}</label>
                        <input type="color" id="theme-${theme}-${field}">
                    `;
                    container.appendChild(row);
                });
            });
        });
    }

    function showError(err) {
        successBox.hidden = true;
        errorBox.textContent = err.message || 'Something went wrong';
        errorBox.hidden = false;
    }
    function showSuccess(msg) {
        errorBox.hidden = true;
        successBox.textContent = msg;
        successBox.hidden = false;
    }

    function applyThemeColors(themeColors) {
        themeOverrides = { light: {}, dark: {} };
        ['light', 'dark'].forEach((theme) => {
            THEME_FIELDS.forEach((field) => {
                const stored = themeColors && themeColors[theme] && themeColors[theme][field];
                document.getElementById(`theme-${theme}-${field}`).value = stored || THEME_DEFAULTS[theme][field];
                if (stored) themeOverrides[theme][field] = stored;
            });
        });
    }

    function applyAccount(account) {
        document.getElementById('account-email').textContent = account.email;
        document.getElementById('account-auth-source').textContent = account.authSource === 'ldap' ? 'LDAP' : 'Local account';
        document.getElementById('home-dashboard').value = account.homeDashboard || 'budget';
        document.getElementById('notify-email').value = account.notifyEmail || '';
        document.getElementById('weekly-report-email').checked = account.weeklyReportEmail;

        document.getElementById('smtp-host').value = account.smtp.host || '';
        document.getElementById('smtp-port').value = account.smtp.port || '';
        document.getElementById('smtp-secure').checked = !!account.smtp.secure;
        document.getElementById('smtp-user').value = account.smtp.user || '';
        document.getElementById('smtp-from').value = account.smtp.from || '';
        document.getElementById('smtp-pass').value = '';
        document.getElementById('smtp-pass-hint').hidden = !account.smtp.hasPassword;

        applyThemeColors(account.themeColors);
    }

    async function load() {
        try {
            const account = await window.BWApi.apiFetch('/api/account');
            applyAccount(account);
        } catch (err) {
            showError(err);
        }
    }

    buildThemeFieldsUI();

    document.getElementById('save-general-btn').addEventListener('click', async () => {
        try {
            await window.BWApi.apiFetch('/api/auth/preferences', {
                method: 'PUT',
                body: { homeDashboard: document.getElementById('home-dashboard').value }
            });
            showSuccess('General settings saved.');
        } catch (err) {
            showError(err);
        }
    });

    document.getElementById('save-notifications-btn').addEventListener('click', async () => {
        try {
            // notifyEmail lives directly on the user doc (see models/user.js)
            // but is saved through /api/auth/preferences rather than the SMTP
            // endpoint, deliberately — so setting it never requires a valid
            // mail server to already be configured.
            await window.BWApi.apiFetch('/api/auth/preferences', {
                method: 'PUT',
                body: {
                    weeklyReportEmail: document.getElementById('weekly-report-email').checked,
                    notifyEmail: document.getElementById('notify-email').value.trim()
                }
            });
            showSuccess('Notification settings saved.');
        } catch (err) {
            showError(err);
        }
    });

    function readSmtpForm() {
        return {
            host: document.getElementById('smtp-host').value.trim(),
            port: document.getElementById('smtp-port').value,
            secure: document.getElementById('smtp-secure').checked,
            user: document.getElementById('smtp-user').value.trim(),
            pass: document.getElementById('smtp-pass').value,
            from: document.getElementById('smtp-from').value.trim()
        };
    }

    document.getElementById('save-smtp-btn').addEventListener('click', async () => {
        try {
            const account = await window.BWApi.apiFetch('/api/account/smtp', { method: 'PUT', body: readSmtpForm() });
            applyAccount(account);
            showSuccess('Mail server settings saved.');
        } catch (err) {
            showError(err);
        }
    });

    document.getElementById('test-smtp-btn').addEventListener('click', async () => {
        const statusEl = document.getElementById('smtp-test-status');
        statusEl.textContent = 'Testing…';
        try {
            const result = await window.BWApi.apiFetch('/api/account/smtp/test', { method: 'POST', body: readSmtpForm() });
            statusEl.textContent = result.ok ? '✓ Connected successfully.' : `✗ ${result.message || 'Connection failed'}`;
        } catch (err) {
            statusEl.textContent = `✗ ${err.message || 'Connection failed'}`;
        }
    });

    document.getElementById('clear-smtp-btn').addEventListener('click', async () => {
        if (!confirm('Clear your saved mail server settings?')) return;
        try {
            const account = await window.BWApi.apiFetch('/api/account/smtp', { method: 'DELETE' });
            applyAccount(account);
            document.getElementById('smtp-test-status').textContent = '';
            showSuccess('Mail server settings cleared.');
        } catch (err) {
            showError(err);
        }
    });

    // ── Appearance (per-theme color overrides) ───────────────────────
    ['light', 'dark'].forEach((theme) => {
        THEME_FIELDS.forEach((field) => {
            document.getElementById(`theme-${theme}-${field}`).addEventListener('input', (e) => {
                themeOverrides[theme][field] = e.target.value;
            });
        });
        document.querySelector(`[data-reset-theme="${theme}"]`).addEventListener('click', () => {
            themeOverrides[theme] = {};
            THEME_FIELDS.forEach((field) => {
                document.getElementById(`theme-${theme}-${field}`).value = THEME_DEFAULTS[theme][field];
                // Explicit nulls — distinct from THEME_DEFAULTS being merely
                // what's shown — so Save actually clears any stored override
                // for this theme instead of re-saving the default as if chosen.
                themeOverrides[theme][field] = null;
            });
        });
    });

    document.getElementById('save-appearance-btn').addEventListener('click', async () => {
        try {
            const prefs = await window.BWApi.apiFetch('/api/auth/preferences', {
                method: 'PUT',
                body: { themeColors: { light: themeOverrides.light, dark: themeOverrides.dark } }
            });
            applyThemeColors(prefs.themeColors);
            showSuccess('Appearance saved — refresh to see it applied everywhere.');
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
