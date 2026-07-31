(function () {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const errorBox = document.getElementById('login-error');
            errorBox.hidden = true;
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const redirect = new URLSearchParams(window.location.search).get('redirect') || '/';

            try {
                await window.BWApi.apiFetch('/api/auth/login', { method: 'POST', body: { email, password } });
                window.location.href = redirect;
            } catch (err) {
                errorBox.textContent = err.message || 'Login failed';
                errorBox.hidden = false;
            }
        });
    }

    const ldapToggleRow = document.getElementById('ldap-toggle-row');
    if (ldapToggleRow) {
        window.BWApi.apiFetch('/api/auth/ldap-status').then((status) => {
            ldapToggleRow.hidden = !status.enabled;
        }).catch(() => { /* leave hidden — no LDAP option shown if this fails */ });

        document.getElementById('toggle-ldap-form-link').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('login-form').hidden = !document.getElementById('login-form').hidden;
            const ldapForm = document.getElementById('ldap-login-form');
            ldapForm.hidden = !ldapForm.hidden;
            e.target.textContent = ldapForm.hidden ? 'Log in with LDAP instead' : 'Log in with email instead';
        });

        document.getElementById('ldap-login-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            const errorBox = document.getElementById('login-error');
            errorBox.hidden = true;
            const username = document.getElementById('ldap-username').value.trim();
            const password = document.getElementById('ldap-password').value;
            const redirect = new URLSearchParams(window.location.search).get('redirect') || '/';

            try {
                await window.BWApi.apiFetch('/api/auth/login-ldap', { method: 'POST', body: { username, password } });
                window.location.href = redirect;
            } catch (err) {
                errorBox.textContent = err.message || 'LDAP login failed';
                errorBox.hidden = false;
            }
        });
    }

    const signupForm = document.getElementById('signup-form');
    if (signupForm) {
        signupForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const errorBox = document.getElementById('signup-error');
            errorBox.hidden = true;
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const displayName = document.getElementById('displayName').value.trim();

            try {
                await window.BWApi.apiFetch('/api/auth/signup', { method: 'POST', body: { email, password, displayName } });
                window.location.href = '/';
            } catch (err) {
                errorBox.textContent = err.message || 'Signup failed';
                errorBox.hidden = false;
            }
        });
    }
})();
