// Turns a user's chosen badge color (see preferences.badgeColors —
// models/user.js) into the inline style a .badge span needs — a background
// plus an automatically-picked readable text color, since asking for two
// colors per badge (background AND text) would be a lot of pickers for a
// small identification tag. Shared by public/js/register.js (Scheduled/Due/
// Autopay badges) and public/js/schedules.js (Due soon/Autopay badges),
// both of which reuse the same three preference keys.
(function (root) {
    // Plain sRGB relative-luminance threshold — good enough for picking
    // black-vs-white text on a small color swatch, not full WCAG APCA.
    function readableTextColor(hex) {
        const h = hex.replace('#', '');
        const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
        const r = parseInt(full.slice(0, 2), 16) / 255;
        const g = parseInt(full.slice(2, 4), 16) / 255;
        const b = parseInt(full.slice(4, 6), 16) / 255;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return luminance > 0.6 ? '#1a1a1a' : '#ffffff';
    }

    // The `style="..."` attribute value for a badge span given a hex color,
    // or '' to fall back to the CSS default (see public/scss/components/
    // _cards.scss's --badge-bg/--badge-color hooks) when no override is set.
    function badgeStyle(hex) {
        if (!hex) return '';
        return `--badge-bg:${hex};--badge-color:${readableTextColor(hex)};`;
    }

    root.BWBadgeColor = { badgeStyle, readableTextColor };
})(window);
