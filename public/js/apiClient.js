// Small fetch wrapper: attaches the CSRF token (fetched once, cached) to
// every mutating request and normalizes JSON error handling.
(function (root) {
    let cachedToken = null;

    async function csrfToken() {
        if (cachedToken) return cachedToken;
        const res = await fetch('/api/auth/csrf-token', { credentials: 'same-origin' });
        const data = await res.json();
        cachedToken = data.csrfToken;
        return cachedToken;
    }

    async function apiFetch(url, { method = 'GET', body } = {}) {
        const headers = {};
        const opts = { method, headers, credentials: 'same-origin' };

        if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
            headers['x-csrf-token'] = await csrfToken();
        }
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }

        const res = await fetch(url, opts);
        let data = null;
        try { data = await res.json(); } catch (err) { /* empty/non-JSON body */ }

        if (!res.ok) {
            const err = new Error((data && data.error) || res.statusText);
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    // For multipart/form-data (bank file import) — no Content-Type set here
    // so the browser can add its own multipart boundary.
    async function apiUpload(url, formData) {
        const res = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'x-csrf-token': await csrfToken() },
            body: formData
        });
        let data = null;
        try { data = await res.json(); } catch (err) { /* empty/non-JSON body */ }

        if (!res.ok) {
            const err = new Error((data && data.error) || res.statusText);
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    root.BWApi = { apiFetch, apiUpload, csrfToken };
})(window);
