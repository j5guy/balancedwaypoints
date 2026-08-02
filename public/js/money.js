// Client-side mirror of utils/money.js — the server never sends a currency
// symbol, only cents, so display formatting happens here.
(function (root) {
    // Fixed-width regardless of the real value — masking a $9 value and a
    // $90,000 value with the same placeholder is the whole point (see the
    // register's mask toggle in public/js/register.js), so this never
    // varies with cents' actual digit count.
    const MASK_LABEL = '•••••';

    function formatCents(cents, masked) {
        if (masked) return MASK_LABEL;
        const value = (Math.abs(cents) / 100).toFixed(2);
        const sign = cents < 0 ? '-' : '';
        return `${sign}$${value}`;
    }

    function toCents(dollars) {
        return Math.round(Number(dollars) * 100);
    }

    root.BWMoney = { formatCents, toCents, MASK_LABEL };
})(window);
