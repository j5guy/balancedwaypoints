(function () {
    const emailEl = document.getElementById('account-email');
    if (!emailEl) return;

    window.BWApi.apiFetch('/api/account').then((account) => {
        emailEl.textContent = account.email;
        document.getElementById('account-auth-source').textContent = account.authSource === 'ldap' ? 'LDAP' : 'Local account';
    }).catch(() => {});
})();
