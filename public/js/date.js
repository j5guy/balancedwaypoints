// Transaction/schedule dates are stored as bare calendar dates (UTC
// midnight — see how <input type="date"> values round-trip below), not
// real point-in-time timestamps. Formatting them with the browser's local
// timezone (plain .toLocaleDateString()) shifts the displayed day back by
// one for anyone west of UTC — this locks formatting to UTC so the
// calendar date shown always matches the one that was entered/stored.
(function (root) {
    function formatDate(dateInput) {
        return new Date(dateInput).toLocaleDateString(undefined, { timeZone: 'UTC' });
    }

    // For <input type="date"> — already timezone-safe since toISOString()
    // always renders in UTC, matching how these dates are stored.
    function toDateInputValue(dateInput) {
        return new Date(dateInput).toISOString().slice(0, 10);
    }

    // "Today" as the user's own local calendar day — deliberately NOT
    // toISOString(), which reads the UTC day and would already show
    // tomorrow's date for anyone west of UTC during their evening hours.
    function todayDateInputValue() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    root.BWDate = { formatDate, toDateInputValue, todayDateInputValue };
})(window);
