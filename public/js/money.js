// Client-side mirror of utils/money.js — the server never sends a currency
// symbol, only cents, so display formatting happens here.
(function (root) {
    function formatCents(cents) {
        const value = (Math.abs(cents) / 100).toFixed(2);
        const sign = cents < 0 ? '-' : '';
        return `${sign}$${value}`;
    }

    function toCents(dollars) {
        return Math.round(Number(dollars) * 100);
    }

    root.BWMoney = { formatCents, toCents };
})(window);
