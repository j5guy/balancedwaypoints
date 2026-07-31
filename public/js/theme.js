(function () {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;

    function apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        toggle.textContent = theme === 'dark' ? '🌙' : '☀️';
    }

    apply(document.documentElement.getAttribute('data-theme') || 'light');

    toggle.addEventListener('click', function () {
        const current = document.documentElement.getAttribute('data-theme');
        apply(current === 'dark' ? 'light' : 'dark');
    });
})();
