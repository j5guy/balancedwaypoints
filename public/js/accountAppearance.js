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
    // applyThemeColors. That's what lets Save send just the fields that
    // actually changed instead of everything currently shown.
    let themeOverrides = { light: {}, dark: {} };

    // Same "only touched fields get sent" convention as themeOverrides
    // above, for the register's Scheduled/Due/Autopay badge colors (see
    // models/user.js's preferences.badgeColors). Defaults are just
    // reasonable starting points shown in the pickers — distinct enough
    // from each other and from the app's own default badge look (a neutral
    // gray) to be visually obvious once picked, but purely a UI starting
    // point; nothing is saved unless the user touches (or resets) a field.
    const BADGE_FIELDS = ['scheduled', 'due', 'autopay'];
    const BADGE_DEFAULTS = { scheduled: '#6E8FAE', due: '#E3A93A', autopay: '#1B6E6E' };
    let badgeOverrides = {};

    function applyBadgeColors(badgeColors) {
        badgeOverrides = {};
        BADGE_FIELDS.forEach((field) => {
            const stored = badgeColors && badgeColors[field];
            document.getElementById(`badge-color-${field}`).value = stored || BADGE_DEFAULTS[field];
            if (stored) badgeOverrides[field] = stored;
        });
    }

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

    async function load() {
        try {
            const [account, prefs] = await Promise.all([
                window.BWApi.apiFetch('/api/account'),
                window.BWApi.apiFetch('/api/auth/preferences')
            ]);
            applyThemeColors(account.themeColors);
            applyBadgeColors(prefs.badgeColors);
        } catch (err) {
            showError(err);
        }
    }

    buildThemeFieldsUI();

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

    BADGE_FIELDS.forEach((field) => {
        document.getElementById(`badge-color-${field}`).addEventListener('input', (e) => {
            badgeOverrides[field] = e.target.value;
        });
    });
    document.getElementById('reset-badge-colors-btn').addEventListener('click', () => {
        badgeOverrides = {};
        BADGE_FIELDS.forEach((field) => {
            document.getElementById(`badge-color-${field}`).value = BADGE_DEFAULTS[field];
            // Explicit nulls, same reasoning as the theme reset above — Save
            // needs to actually clear any stored override, not just show the
            // default in the picker.
            badgeOverrides[field] = null;
        });
    });
    document.getElementById('save-badge-colors-btn').addEventListener('click', async () => {
        try {
            const prefs = await window.BWApi.apiFetch('/api/auth/preferences', {
                method: 'PUT',
                body: { badgeColors: badgeOverrides }
            });
            applyBadgeColors(prefs.badgeColors);
            showSuccess('Badge colors saved.');
        } catch (err) {
            showError(err);
        }
    });

    load();
})();
