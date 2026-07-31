const { currencySymbol } = require('../config/config');

// All amounts are stored/passed around internally as integer cents — these
// are the only two places that ever convert to/from a decimal display value.
const toCents = (dollars) => Math.round(Number(dollars) * 100);

const formatCents = (cents) => {
    const value = (Math.abs(cents) / 100).toFixed(2);
    const sign = cents < 0 ? '-' : '';
    return `${sign}${currencySymbol}${value}`;
};

module.exports = { toCents, formatCents };
