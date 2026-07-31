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
