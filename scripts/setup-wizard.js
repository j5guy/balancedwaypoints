#!/usr/bin/env node
// Interactive .env setup wizard. Reads .env.example for the field list, help
// text, and defaults; serves a form on localhost; writes the result to .env;
// generates a self-signed TLS cert if needed; then brings up the Docker
// stack and exits.
//
// Deliberately simpler than a from-scratch enterprise installer: Docker-only
// (no local systemd service path, no existing-host-nginx auto-wiring, no
// minimal-footprint relocation) — see the balancedwaypoints project plan for
// why. Everything here can be done by hand instead by editing .env directly
// and running `docker compose -f docker-compose.yml -f docker-compose.nginx.yml
// -f docker-compose.mongo.yml up -d --build`.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { lanAddresses, printAccessUrls, highlight } = require('./lib/network');
const { mongoNeedsLegacyArmImage, LEGACY_ARM_MONGO_IMAGE, generateCert, bringUpDocker, APP_PORT } = require('./lib/bringUp');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const EXAMPLE_PATH = path.join(ROOT, '.env.example');

const FIELD_LABELS = {
    WEB_FQDN: 'Domain name (or IP)',
    NGINX_HTTPS_PORT: 'HTTPS port',
    NGINX_HTTP_PORT: 'HTTP port (redirects to HTTPS)',
    SSL_CERT_FILE: 'Certificate file',
    SSL_KEY_FILE: 'Certificate key file',
    ADMIN_EMAIL: 'Always-admin email (optional)',
    CURRENCY_SYMBOL: 'Currency symbol',
    mongoHost: 'MongoDB host',
    mongoUser: 'MongoDB username',
    mongoPass: 'MongoDB password',
    mongoPort: 'MongoDB port',
    mongoDBName: 'MongoDB database name',
    LDAP_ENABLED: 'Enable LDAP login (true/false)',
    LDAP_URL: 'LDAP server URL',
    LDAP_BIND_DN: 'LDAP bind DN',
    LDAP_BIND_PASSWORD: 'LDAP bind password',
    LDAP_SEARCH_BASE: 'LDAP search base',
    LDAP_SEARCH_FILTER: 'LDAP search filter'
};
const MASKED_KEYS = new Set(['mongoPass', 'LDAP_BIND_PASSWORD']);
const HIDDEN_KEYS = new Set(['sessionSecret', 'MONGO_IMAGE']);
const MONGO_EXTERNAL_ONLY_KEYS = new Set(['mongoHost', 'mongoUser', 'mongoPass']);
const REQUIRED_KEYS = new Set(['WEB_FQDN']);

function parseExample(text) {
    const fields = [];
    let pendingHelp = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trimEnd();
        if (line.startsWith('# ──')) { pendingHelp = []; continue; }
        if (line.startsWith('#')) {
            const t = line.replace(/^#\s?/, '');
            if (t.trim()) pendingHelp.push(t);
            continue;
        }
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) {
            fields.push({ key: m[1], default: m[2], help: pendingHelp.join(' ') });
            pendingHelp = [];
            continue;
        }
        if (!line.trim()) pendingHelp = [];
    }
    return fields;
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderForm(fields, values, mongoMode, certMode) {
    const rows = fields.filter(f => !HIDDEN_KEYS.has(f.key)).map(f => {
        const value = values[f.key] !== undefined ? values[f.key] : f.default;
        const isMongoOnly = MONGO_EXTERNAL_ONLY_KEYS.has(f.key);
        const disabled = isMongoOnly && mongoMode !== 'external';
        const isCertField = f.key === 'SSL_CERT_FILE' || f.key === 'SSL_KEY_FILE';
        const certDisabled = isCertField && certMode !== 'own';
        const inputType = MASKED_KEYS.has(f.key) ? 'password' : 'text';
        return `
        <div class="field">
          <label for="${f.key}">${escapeHtml(FIELD_LABELS[f.key] || f.key)}</label>
          ${f.help ? `<p class="help">${escapeHtml(f.help)}</p>` : ''}
          <input type="${inputType}" id="${f.key}" name="${f.key}" value="${escapeHtml(value)}" ${(disabled || certDisabled) ? 'disabled' : ''} autocomplete="off" />
        </div>`;
    }).join('\n');

    const armNote = mongoNeedsLegacyArmImage()
        ? `<p class="help warn">This CPU needs an older MongoDB image (${LEGACY_ARM_MONGO_IMAGE}) — set automatically.</p>`
        : '';

    return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Balanced Waypoints Setup</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; max-width: 680px; margin: 2rem auto; padding: 0 1rem; line-height: 1.4; }
  fieldset { border: 1px solid #ccc; border-radius: 8px; margin-bottom: 1.25rem; padding: 0.75rem 1rem 1rem; }
  legend { font-weight: 600; padding: 0 0.5rem; }
  .field { margin-bottom: 0.9rem; }
  label { display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.15rem; }
  .help { margin: 0 0 0.35rem; font-size: 0.8rem; color: #777; }
  .help.warn { color: #b3261e; font-weight: 600; }
  input { width: 100%; padding: 0.4rem 0.5rem; border: 1px solid #bbb; border-radius: 6px; font-size: 0.95rem; box-sizing: border-box; }
  input:disabled { opacity: 0.5; background: #eee; }
  .radio-row { display: flex; flex-direction: column; gap: 0.35rem; }
  button { padding: 0.6rem 1.4rem; font-size: 1rem; border: none; border-radius: 8px; background: #1B6E6E; color: white; cursor: pointer; }
</style></head>
<body>
  <h1>Balanced Waypoints — Setup</h1>
  <p>Fill in the fields below, then submit. This writes <code>.env</code> and brings up the Docker stack.</p>
  <form method="POST" action="/save">
    <fieldset>
      <legend>MongoDB</legend>
      <div class="radio-row">
        <label><input type="radio" name="mongoMode" value="internal" ${mongoMode !== 'external' ? 'checked' : ''} /> Internal (bundled MongoDB container, recommended)</label>
        <label><input type="radio" name="mongoMode" value="external" ${mongoMode === 'external' ? 'checked' : ''} /> External (point at an existing MongoDB server)</label>
      </div>
      ${armNote}
    </fieldset>
    <fieldset>
      <legend>TLS certificate</legend>
      <div class="radio-row">
        <label><input type="radio" name="certMode" value="generate" ${certMode !== 'own' ? 'checked' : ''} /> Generate one (self-signed local CA, recommended)</label>
        <label><input type="radio" name="certMode" value="own" ${certMode === 'own' ? 'checked' : ''} /> I'll provide my own certificate files</label>
      </div>
    </fieldset>
    <fieldset><legend>Configuration</legend>${rows}</fieldset>
    <button type="submit">Save &amp; start</button>
  </form>
</body></html>`;
}

function renderDone(caCertPem) {
    const caSection = caCertPem ? `
<h2>Trust the local CA</h2>
<p>Your browser won't trust this certificate automatically. Download and install it into your OS/browser
trust store on any device that needs to reach this site without a warning.</p>
<p><a download="balancedwaypoints-ca.pem" href="data:application/x-pem-file;base64,${Buffer.from(caCertPem, 'utf8').toString('base64')}">Download CA certificate</a></p>` : '';
    return `<!doctype html><html><head><meta charset="utf-8" /><title>Setup complete</title></head>
<body><h1>.env written</h1>${caSection}<p>Close this tab — the terminal will continue automatically.</p></body></html>`;
}

async function main() {
    const exampleText = fs.readFileSync(EXAMPLE_PATH, 'utf8');
    const fields = parseExample(exampleText);
    const existing = fs.existsSync(ENV_PATH)
        ? Object.fromEntries(fs.readFileSync(ENV_PATH, 'utf8').split('\n').map(l => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
        : {};

    const app = express();
    app.use(express.urlencoded({ extended: true }));

    let resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });

    app.get('/', (req, res) => {
        res.send(renderForm(fields, existing, existing.mongoHost && existing.mongoHost !== 'mongo' ? 'external' : 'internal', existing.SSL_CERT_FILE ? 'own' : 'generate'));
    });

    app.post('/save', (req, res) => {
        const body = req.body;
        const mongoMode = body.mongoMode === 'external' ? 'external' : 'internal';
        const certMode = body.certMode === 'own' ? 'own' : 'generate';

        const values = {};
        fields.forEach(f => { values[f.key] = body[f.key] !== undefined ? body[f.key] : (existing[f.key] || f.default); });
        if (mongoMode === 'internal') values.mongoHost = 'mongo';
        values.sessionSecret = existing.sessionSecret || crypto.randomBytes(64).toString('hex');
        if (mongoNeedsLegacyArmImage()) values.MONGO_IMAGE = LEGACY_ARM_MONGO_IMAGE;

        let caCertPem = null;
        if (certMode === 'generate') {
            const result = generateCert(ROOT, values.WEB_FQDN || 'localhost');
            if (!result.ok) return res.status(500).send(`<pre>${escapeHtml(result.message)}</pre>`);
            values.SSL_CERT_FILE = result.certPath;
            values.SSL_KEY_FILE = result.keyPath;
            caCertPem = result.caCertPem;
        }

        const envText = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
        fs.writeFileSync(ENV_PATH, envText);

        res.send(renderDone(caCertPem));
        resolveDone({ mongoMode, values });
    });

    const server = app.listen(0, () => {
        const { port } = server.address();
        console.log(`\nOpen this URL in a browser to continue setup:\n  ${highlight(`http://localhost:${port}/`)}`);
    });

    const { mongoMode, values } = await done;
    server.close();

    bringUpDocker(ROOT, mongoMode);
    printAccessUrls(values.WEB_FQDN || 'localhost', values.NGINX_HTTPS_PORT || APP_PORT);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
