// Canonical list of every customizable theme field, mapped to the CSS
// custom property it overrides (see public/scss/layout/_base.scss's
// :root/[data-theme] blocks — this is every variable defined there).
// Shared between models/user.js's field names, controllers/authController.js's
// validation, and views/components/head.ejs's <style> injection, so all
// three always agree on exactly what's customizable. public/js/accountAppearance.js
// duplicates this list (client-side code can't require() a server module
// without a build step) — keep the two in sync if this list ever changes.
const THEME_COLOR_FIELDS = [
    ['bgBase', '--bg-base'],
    ['bgSecondary', '--bg-secondary'],
    ['bgCard', '--bg-card'],
    ['bgHover', '--bg-hover'],
    ['border', '--border'],
    ['borderLight', '--border-light'],
    ['textPrimary', '--text-primary'],
    ['textSecondary', '--text-secondary'],
    ['textMuted', '--text-muted'],
    ['accent', '--accent'],
    ['navBg', '--nav-bg'],
    ['navText', '--nav-text']
];

module.exports = THEME_COLOR_FIELDS;
