// Thin wrapper around the SimpleFIN Bridge protocol (https://www.simplefin.org/protocol.html).
// Two calls only:
//  - claimAccessUrl: exchanges a one-time setup token (pasted by the user)
//    for a permanent access URL. The setup token is base64 of a claim URL;
//    POSTing to that claim URL (once — it's single-use per the protocol)
//    returns the access URL as a plain-text body.
//  - fetchAccounts: GETs <access url>/accounts for one or more remote
//    accounts. The access URL embeds HTTP Basic credentials
//    (https://user:pass@bridge.example/simplefin) — Node's fetch won't send
//    userinfo-in-URL credentials automatically, so this pulls them out and
//    sets an explicit Authorization header instead.
class SimplefinError extends Error {}

function decodeSetupToken(setupToken) {
    let claimUrl;
    try {
        claimUrl = Buffer.from(String(setupToken || '').trim(), 'base64').toString('utf8');
    } catch (err) {
        throw new SimplefinError('Setup token is not valid base64');
    }
    if (!/^https?:\/\//i.test(claimUrl)) {
        throw new SimplefinError('Setup token did not decode to a valid claim URL');
    }
    return claimUrl;
}

async function claimAccessUrl(setupToken) {
    const claimUrl = decodeSetupToken(setupToken);
    const res = await fetch(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' } });
    const accessUrl = (await res.text()).trim();
    if (!res.ok || !accessUrl) {
        // A claim URL is single-use — the most common failure by far is
        // re-submitting a token that already got claimed (e.g. a retried
        // request), so the error steers toward that rather than a generic
        // "request failed".
        throw new SimplefinError(`Couldn't claim setup token (${res.status}) — it may have already been used. Generate a new one and try again.`);
    }
    if (!/^https?:\/\/.+@/.test(accessUrl)) {
        throw new SimplefinError('Claim response did not look like a SimpleFIN access URL');
    }
    return accessUrl;
}

// Splits the embedded Basic Auth credentials out of the access URL, since
// they need to travel as an explicit header rather than URL userinfo.
function parseAccessUrl(accessUrl) {
    const url = new URL(accessUrl);
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    url.username = '';
    url.password = '';
    return {
        baseUrl: url.toString().replace(/\/$/, ''),
        authHeader: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
    };
}

// startDate: JS Date — only transactions posted on/after this are returned.
// accountIds: optional array to scope the fetch to specific remote accounts
// instead of every account this access URL can see.
async function fetchAccounts(accessUrl, { startDate, accountIds } = {}) {
    const { baseUrl, authHeader } = parseAccessUrl(accessUrl);
    const params = new URLSearchParams();
    params.set('pending', '1');
    if (startDate) params.set('start-date', String(Math.floor(startDate.getTime() / 1000)));
    (accountIds || []).forEach((id) => params.append('account', id));

    const res = await fetch(`${baseUrl}/accounts?${params.toString()}`, {
        headers: { Authorization: authHeader }
    });
    if (!res.ok) {
        throw new SimplefinError(`SimpleFIN request failed (${res.status})`);
    }
    const data = await res.json();
    return { accounts: data.accounts || [], errors: data.errors || [] };
}

// For logs/error messages — never write the real credentials anywhere persistent.
function redact(accessUrl) {
    try {
        const url = new URL(accessUrl);
        return `${url.protocol}//***@${url.host}${url.pathname}`;
    } catch (err) {
        return '(unparseable access URL)';
    }
}

module.exports = { claimAccessUrl, fetchAccounts, redact, SimplefinError };
