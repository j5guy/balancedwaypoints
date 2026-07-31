const config = require('../../config/config');

function wrapEmail({ title, bodyHtml }) {
    return `
    <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#F6F5F1;color:#22282A;">
        <div style="text-align:center;margin-bottom:24px;">
            <div style="font-size:1.2rem;font-weight:700;color:#22282A;">Balanced Waypoints</div>
        </div>
        <div style="background:#FFFFFF;border-radius:12px;padding:28px;">
            <h1 style="font-size:1.3rem;margin:0 0 16px;color:#22282A;">${title}</h1>
            ${bodyHtml}
        </div>
        <p style="text-align:center;color:#666F72;font-size:0.8rem;margin-top:24px;">
            Balanced Waypoints — ${config.appBaseUrl}
        </p>
    </div>`;
}

function button(url, label) {
    return `<a href="${url}" style="display:inline-block;background:#1B6E6E;color:#ffffff;text-decoration:none;` +
        `padding:12px 24px;border-radius:999px;font-weight:600;margin:16px 0;">${label}</a>`;
}

module.exports = { wrapEmail, button };
