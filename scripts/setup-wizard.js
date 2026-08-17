#!/usr/bin/env node
// Interactive .env setup wizard. Reads .env.example for the field list, help
// text, and defaults; serves a form on localhost; writes the result to
// FINAL_DIR/.env; generates a self-signed TLS cert if needed; then trims
// down to a minimal Docker-only footprint at FINAL_DIR (see ./lib/footprint),
// brings the Docker stack up, and exits.
//
// Deliberately simpler than a from-scratch enterprise installer: Docker-only
// (no local systemd service path) — see the balancedwaypoints project plan
// for why. Reachability over HTTPS comes from joining the shared Traefik
// reverse proxy (see ensureTraefikStack/resolveTlsMode in ./lib/bringUp) —
// one shared proxy every Waypoints app joins, routed entirely by Docker
// labels, no per-app port to pick. Everything here can be done by hand
// instead by editing .env directly and running `docker compose -f
// docker-compose.yml -f docker-compose.mongo.yml up -d --build`.
//
// Runs against ROOT (this checkout — a scratch clone when launched via
// install.sh with --final-dir, or an existing checkout when run in place)
// and, once .env is written, trims it down to just what's needed to
// run/update Docker and writes THAT to FINAL_DIR (see ./lib/footprint).
// Skipped entirely when run in place (no --final-dir, e.g. an in-place
// `./install.sh`/`node scripts/setup-wizard.js`) — there's no separate
// scratch checkout to trim away in that case, so the full source just stays
// put and FINAL_DIR defaults to ROOT itself (no relocation).
const fs = require('fs');
const net = require('net');
const dns = require('dns');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { lanAddresses, printAccessUrls, highlight } = require('./lib/network');
const {
    mongoNeedsLegacyArmImage, LEGACY_ARM_MONGO_IMAGE, generateCert, bringUpDocker,
    resolveTraefikDir, ensureTraefikStack, resolveTlsMode, findOpenPort, isPortFree,
    writeDeployState, run
} = require('./lib/bringUp');
const { trimToMinimalFootprint } = require('./lib/footprint');
const { detectPortal, installPortalNonInteractive, readPortalEnv, registerOidcClient } = require('./lib/portal');

function parseArgs(argv) {
    const args = { finalDir: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--final-dir' && argv[i + 1]) args.finalDir = argv[++i];
    }
    return args;
}
const cliArgs = parseArgs(process.argv.slice(2));

const ROOT = path.join(__dirname, '..');
const FINAL_DIR = cliArgs.finalDir ? path.resolve(cliArgs.finalDir) : ROOT;
// True only when launched by install.sh against a scratch clone distinct
// from where the app should actually end up living — the only case where
// there's a scratch checkout to trim down afterward (see
// renderFootprintFieldset below).
const IS_SCRATCH = path.resolve(FINAL_DIR) !== path.resolve(ROOT);
// .env/certs/ are written straight to FINAL_DIR from the start (not ROOT),
// even while ROOT is still a scratch clone — that way there's no host-path
// rewriting needed afterward: a generated cert's absolute path, or
// SSL_CERT_FILE/SSL_KEY_FILE written into .env, already point at FINAL_DIR
// from the moment they're created. See trimToMinimalFootprint in
// scripts/lib/footprint.js.
const ENV_PATH = path.join(FINAL_DIR, '.env');
const EXAMPLE_PATH = path.join(ROOT, '.env.example');

const FIELD_LABELS = {
    WEB_FQDN: 'Domain name (or IP)',
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
// TLS_MODE is rendered as its own radio fieldset (like mongoMode/certMode
// below), not through the generic per-field loop.
const HIDDEN_KEYS = new Set(['sessionSecret', 'MONGO_IMAGE', 'TLS_MODE']);
const MONGO_EXTERNAL_ONLY_KEYS = new Set(['mongoHost', 'mongoUser', 'mongoPass']);
const MONGO_INTERNAL_ONLY_KEYS = new Set(['MONGO_HOST_DIR']);
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

// Only relevant when running against a scratch clone distinct from FINAL_DIR
// (IS_SCRATCH) — that's the only case where there's a source checkout to
// trim away in the first place; a checkout already at its final home has
// nowhere else to go. No longer a user choice — every scratch install ends
// up Docker only, minimal footprint. See trimToMinimalFootprint in
// ./lib/footprint.
function renderFootprintFieldset() {
    if (!IS_SCRATCH) {
        return `
    <fieldset>
      <legend>Installation footprint</legend>
      <p class="help">This checkout is already the install location, so the full source stays here.</p>
    </fieldset>`;
    }
    return `
    <fieldset>
      <legend>Installation footprint</legend>
      <p class="help">Docker only, minimal footprint — builds the image, then deletes the source, leaving
      just what's needed to run and update the stack at <code>${escapeHtml(FINAL_DIR)}</code>.
      <code>update.sh</code> in that directory is the one command to update later.</p>
    </fieldset>`;
}

function renderForm(fields, values, mongoMode, certMode, tlsMode, portalInfo) {
    const rows = fields.filter(f => !HIDDEN_KEYS.has(f.key)).map(f => {
        const value = values[f.key] !== undefined ? values[f.key] : f.default;
        const isMongoOnly = MONGO_EXTERNAL_ONLY_KEYS.has(f.key);
        const isMongoInternalOnly = MONGO_INTERNAL_ONLY_KEYS.has(f.key);
        const disabled = (isMongoOnly && mongoMode !== 'external') || (isMongoInternalOnly && mongoMode !== 'internal');
        const isCertField = f.key === 'SSL_CERT_FILE' || f.key === 'SSL_KEY_FILE';
        const certDisabled = isCertField && certMode !== 'own';
        const inputType = MASKED_KEYS.has(f.key) ? 'password' : 'text';
        const isFqdn = f.key === 'WEB_FQDN';
        return `
        <div class="field">
          <label for="${f.key}">${escapeHtml(FIELD_LABELS[f.key] || f.key)}</label>
          ${f.help ? `<p class="help">${escapeHtml(f.help)}</p>` : ''}
          <input type="${inputType}" id="${f.key}" name="${f.key}" value="${escapeHtml(value)}" ${(disabled || certDisabled) ? 'disabled' : ''} autocomplete="off" ${isFqdn ? 'data-dns-check="1"' : ''} />
          ${isFqdn ? `<p class="help dns-status" id="dns-status-WEB_FQDN" style="display:none"></p>` : ''}
        </div>`;
    }).join('\n');

    const armNote = mongoNeedsLegacyArmImage()
        ? `<p class="help warn">This CPU needs an older MongoDB image (${LEGACY_ARM_MONGO_IMAGE}) — set automatically.</p>`
        : '';

    // How this app gets its HTTPS certificate, via the shared Traefik proxy
    // every Waypoints app joins (see ensureTraefikStack/resolveTlsMode in
    // ./lib/bringUp) — mirrors the mongoMode/certMode radio-row shape below.
    const tlsModeHtml = `
    <fieldset>
      <legend>TLS certificate mode</legend>
      <div class="radio-row">
        <label><input type="radio" name="TLS_MODE" value="auto" ${tlsMode !== 'acme' && tlsMode !== 'selfsigned' ? 'checked' : ''} /> Automatic (recommended — Let's Encrypt if the domain above looks public, self-signed otherwise)</label>
        <label><input type="radio" name="TLS_MODE" value="acme" ${tlsMode === 'acme' ? 'checked' : ''} /> Always use Let's Encrypt</label>
        <label><input type="radio" name="TLS_MODE" value="selfsigned" ${tlsMode === 'selfsigned' ? 'checked' : ''} /> Always use a self-signed certificate</label>
      </div>
    </fieldset>`;

    // Offers to install the Waypoints Portal (shared login across the
    // Waypoints family) right after this app's own setup finishes — but
    // only when one isn't already running on this host (see detectPortal in
    // ./lib/portal), so two portals never end up installed by accident.
    // Installed non-interactively (see installPortalNonInteractive) using
    // just the domain/port collected right here — its own setup wizard
    // never opens. Either way (already running, or freshly installed here),
    // checking this also registers this app as an SSO client of the portal
    // and turns on OIDC login automatically — see registerOidcClient.
    const portalDefaultFqdn = values.WEB_FQDN || (fields.find(f => f.key === 'WEB_FQDN') || {}).default || 'localhost';
    const portalHtml = portalInfo.running
        ? `<label class="checkbox-label"><input type="checkbox" id="installPortal" name="installPortal" value="1" checked /> Link this app's login to the Waypoints Portal already running at <code>${escapeHtml(portalInfo.url)}</code>, for shared login (SSO)</label>`
        : `<label class="checkbox-label"><input type="checkbox" id="installPortal" name="installPortal" value="1" /> Also install the Waypoints Portal on this host, and link this app's login to it, for shared login (SSO) across your Waypoints apps</label>
      <div id="portal-install-fields" style="display:none">
        <div class="field">
          <label for="PORTAL_WEB_FQDN">Portal domain (or IP)</label>
          <input type="text" id="PORTAL_WEB_FQDN" name="PORTAL_WEB_FQDN" value="${escapeHtml(portalDefaultFqdn)}" autocomplete="off" />
        </div>
        <div class="field">
          <label for="PORTAL_PORT">Portal port</label>
          <input type="text" id="PORTAL_PORT" name="PORTAL_PORT" value="5585" autocomplete="off" data-port-check="1" />
          <p class="help port-status" id="port-status-PORTAL_PORT" style="display:none"></p>
        </div>
      </div>`;

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
  .help.pass { color: #2d6a4f; font-weight: 600; }
  input[type=text], input[type=password] { width: 100%; padding: 0.4rem 0.5rem; border: 1px solid #bbb; border-radius: 6px; font-size: 0.95rem; box-sizing: border-box; }
  input[type=text]:disabled, input[type=password]:disabled { opacity: 0.5; background: #eee; }
  .radio-row { display: flex; flex-direction: column; gap: 0.35rem; }
  .radio-row label, .checkbox-label { display: flex; align-items: center; gap: 0.4rem; font-weight: 400; }
  button { padding: 0.6rem 1.4rem; font-size: 1rem; border: none; border-radius: 8px; background: #1B6E6E; color: white; cursor: pointer; }
  @media (prefers-color-scheme: dark) {
    fieldset { border-color: #444; }
    .help { color: #999; }
    input[type=text], input[type=password] { background: #2a2a2a; color: #eee; border-color: #555; }
    input[type=text]:disabled, input[type=password]:disabled { background: #222; }
    .help.warn { color: #ff8a80; }
    .help.pass { color: #6fcf97; }
  }
</style></head>
<body>
  <h1>Balanced Waypoints — Setup</h1>
  <p>Fill in the fields below, then submit. This writes <code>.env</code> and brings up the Docker stack.</p>
  <form method="POST" action="/save">
    ${renderFootprintFieldset()}
    <fieldset>
      <legend>MongoDB</legend>
      <div class="radio-row">
        <label><input type="radio" name="mongoMode" value="external" ${mongoMode === 'external' ? 'checked' : ''} /> External (point at an existing MongoDB server, recommended — share one instance across your Waypoints apps instead of a separate container per app)</label>
        <label><input type="radio" name="mongoMode" value="internal" ${mongoMode !== 'external' ? 'checked' : ''} /> Internal (bundled MongoDB container, standalone)</label>
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
    ${tlsModeHtml}
    <fieldset>
      <legend>Waypoints Portal</legend>
      ${portalHtml}
    </fieldset>
    <fieldset><legend>Configuration</legend>${rows}</fieldset>
    <button type="submit">Save &amp; start</button>
  </form>
  <script>
    // Live DNS resolution check for the domain field — informational only,
    // doesn't block submitting the form (a name that isn't in DNS yet is a
    // normal thing to still be setting up).
    const dnsCheckTimers = {};
    const dnsCheckSeq = {};
    function checkDns(input) {
      const status = document.getElementById('dns-status-' + input.id);
      if (!status) return;
      const value = input.value.trim();
      if (!value) { status.style.display = 'none'; return; }
      const requestId = (dnsCheckSeq[input.id] = (dnsCheckSeq[input.id] || 0) + 1);
      fetch('/check-dns?fqdn=' + encodeURIComponent(value))
        .then((r) => r.json())
        .then((data) => {
          if (dnsCheckSeq[input.id] !== requestId) return; // a newer check superseded this one
          if (data.resolves) {
            status.textContent = 'This name resolves in DNS.';
            status.className = 'help dns-status pass';
          } else {
            status.textContent = "This name isn't resolving in DNS yet. Setup can still proceed, but it's recommended to have it in DNS (or a hosts file entry) before you rely on it.";
            status.className = 'help dns-status warn';
          }
          status.style.display = '';
        })
        .catch(() => { status.style.display = 'none'; });
    }
    document.querySelectorAll('input[data-dns-check]').forEach((input) => {
      input.addEventListener('input', () => {
        clearTimeout(dnsCheckTimers[input.id]);
        dnsCheckTimers[input.id] = setTimeout(() => checkDns(input), 500);
      });
      checkDns(input); // initial check for the prefilled value
    });

    // Live availability check for any port field — attempts an actual bind
    // on this host (server-side, via /check-port) rather than a well-known
    // list, so it catches anything already using it, whatever that is.
    // Suggests the next free port when taken.
    const portCheckTimers = {};
    const portCheckSeq = {};
    function checkPort(input) {
      const status = document.getElementById('port-status-' + input.id);
      if (!status) return;
      const value = input.value.trim();
      if (!value) { status.style.display = 'none'; return; }
      const requestId = (portCheckSeq[input.id] = (portCheckSeq[input.id] || 0) + 1);
      fetch('/check-port?port=' + encodeURIComponent(value))
        .then((r) => r.json())
        .then((data) => {
          if (portCheckSeq[input.id] !== requestId) return; // a newer check superseded this one
          if (!data.valid) {
            status.textContent = 'Enter a port number between 1 and 65535.';
            status.className = 'help port-status warn';
          } else if (data.free) {
            status.textContent = 'PASS: port ' + value + ' is free.';
            status.className = 'help port-status pass';
          } else {
            status.innerHTML = 'Port ' + value + ' is already in use — try <a href="#" data-use-port="' +
              data.suggestion + '">' + data.suggestion + '</a> instead.';
            status.className = 'help port-status warn';
            const link = status.querySelector('[data-use-port]');
            if (link) {
              link.addEventListener('click', (e) => {
                e.preventDefault();
                input.value = link.dataset.usePort;
                checkPort(input);
              });
            }
          }
          status.style.display = '';
        })
        .catch(() => { status.style.display = 'none'; });
    }
    document.querySelectorAll('input[data-port-check]').forEach((input) => {
      input.addEventListener('input', () => {
        clearTimeout(portCheckTimers[input.id]);
        portCheckTimers[input.id] = setTimeout(() => checkPort(input), 400);
      });
      checkPort(input); // initial check for the prefilled/suggested value
    });

    // "Also install the Waypoints Portal" reveals its domain/port fields —
    // hidden until then since they're meaningless otherwise.
    const installPortalToggle = document.getElementById('installPortal');
    if (installPortalToggle) {
      installPortalToggle.addEventListener('change', () => {
        const fields = document.getElementById('portal-install-fields');
        if (fields) fields.style.display = installPortalToggle.checked ? '' : 'none';
      });
    }
  </script>
</body></html>`;
}

function renderDone(caCertPem) {
    // Embedded as a data: URI so the download still works even after this
    // process exits later (once docker compose finishes).
    const caSection = caCertPem ? `
      <div class="card">
        <h2>Trust the local CA</h2>
        <p>Your browser and OS won't trust this certificate automatically — it wasn't issued by a public CA.
        Download and install it into your OS/browser trust store on any device that needs to reach this site
        without a warning. This is a one-time step per device; the CA's private key never left the server.</p>
        <p><a class="btn" download="balancedwaypoints-ca.pem"
        href="data:application/x-pem-file;base64,${Buffer.from(caCertPem, 'utf8').toString('base64')}">Download CA certificate</a></p>
        <p class="fallback-note">Some browsers (Brave included) block or warn on downloads like this one — if
        that happens, the same file is sitting directly on this host's filesystem, outside Docker entirely, and
        never goes away on its own: <code>${escapeHtml(path.join(FINAL_DIR, 'certs', 'ca.pem'))}</code>. Copy it from
        there instead (<code>scp</code>, a shared folder, a USB drive — whatever gets it onto the other device).</p>
      </div>` : '';
    return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Setup complete</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; max-width: 560px; margin: 3rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.1rem; }
  .status { display: flex; align-items: center; gap: 0.6rem; }
  .status-dot { width: 0.7rem; height: 0.7rem; border-radius: 50%; background: #2d6a4f; flex: none; }
  .card { border: 1px solid #ccc; border-radius: 8px; padding: 1rem 1.25rem; margin-top: 1.5rem; }
  .btn { display: inline-block; padding: 0.6rem 1.4rem; font-size: 1rem; border: none; border-radius: 8px; background: #1B6E6E; color: white; text-decoration: none; cursor: pointer; }
  .btn:hover { filter: brightness(0.92); }
  .fallback-note { font-size: 0.85rem; color: #777; }
  .continue-note { color: #777; font-size: 0.9rem; }
  code { background: #f0f0f0; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
  @media (prefers-color-scheme: dark) {
    body { color: #eee; }
    .card { border-color: #444; }
    .fallback-note, .continue-note { color: #999; }
    code { background: #2a2a2a; }
  }
</style></head>
<body>
  <p class="status"><span class="status-dot"></span><strong>.env written</strong> — bringing up the Docker stack now.</p>
  ${caSection}
  <p class="continue-note">You can close this tab. Continuing in the terminal...</p>
</body></html>`;
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

    app.get('/', async (req, res) => {
        const portalInfo = await detectPortal();
        res.send(renderForm(
            fields, existing,
            existing.mongoHost !== 'mongo' ? 'external' : 'internal',
            existing.SSL_CERT_FILE ? 'own' : 'generate',
            existing.TLS_MODE || 'auto',
            portalInfo
        ));
    });

    // Live DNS resolution check for WEB_FQDN — informational only, doesn't
    // block submitting the form (see the client-side checkDns() above).
    app.get('/check-dns', async (req, res) => {
        const fqdn = String(req.query.fqdn || '').trim();
        if (!fqdn) return res.json({ resolves: false });
        if (net.isIP(fqdn)) return res.json({ resolves: true }); // an IP literal needs no DNS lookup
        try {
            await dns.promises.lookup(fqdn);
            res.json({ resolves: true });
        } catch {
            res.json({ resolves: false });
        }
    });

    // Live availability check for any port field — see the client-side
    // checkPort() above.
    app.get('/check-port', async (req, res) => {
        const port = parseInt(req.query.port, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return res.json({ valid: false });
        const free = await isPortFree(port);
        if (free) return res.json({ valid: true, free: true });
        res.json({ valid: true, free: false, suggestion: await findOpenPort(port + 1) });
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

        // No longer a user choice — a scratch clone always trims down to the
        // minimal Docker-only footprint; a checkout already at its final home
        // (not a scratch clone) has nowhere to trim to, so it just stays put.
        const footprint = IS_SCRATCH ? 'minimal' : 'full';

        fs.mkdirSync(FINAL_DIR, { recursive: true });

        let caCertPem = null;
        if (certMode === 'generate') {
            const result = generateCert(FINAL_DIR, values.WEB_FQDN || 'localhost');
            if (!result.ok) return res.status(500).send(`<pre>${escapeHtml(result.message)}</pre>`);
            values.SSL_CERT_FILE = result.certPath;
            values.SSL_KEY_FILE = result.keyPath;
            caCertPem = result.caCertPem;
        }

        const envText = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
        fs.writeFileSync(ENV_PATH, envText);

        res.send(renderDone(caCertPem));
        resolveDone({
            mongoMode, values, footprint,
            installPortal: body.installPortal === '1',
            portalWebFqdn: body.PORTAL_WEB_FQDN, portalPort: body.PORTAL_PORT
        });
    });

    const server = app.listen(0, () => {
        const { port } = server.address();
        // localhost only works if you have a browser right on this machine —
        // offer the LAN IP(s) too, for the common case of SSH'd into a
        // headless server and continuing setup from a browser elsewhere on
        // the network.
        const urls = [`http://localhost:${port}/`, ...lanAddresses().map(addr => `http://${addr}:${port}/`)];
        console.log(`\nOpen one of these URLs in a browser to continue setup (use localhost if this is a machine with its own browser, otherwise pick the LAN address reachable from wherever you're browsing from):`);
        for (const url of urls) console.log(`  ${highlight(url)}`);
    });

    const { mongoMode, values, footprint, installPortal, portalWebFqdn, portalPort } = await done;
    server.close();

    let installedVersion = 'unknown';
    try {
        installedVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    } catch { /* leave as 'unknown' */ }

    // Resolved once here (not left as the raw "auto"/"acme"/"selfsigned"
    // TLS_MODE value) since both bringUpDocker's compose-file selection and
    // the self-signed cert registration below need the concrete answer.
    const resolvedTlsMode = resolveTlsMode(values.WEB_FQDN || 'localhost', values.TLS_MODE);

    // The external waypoints-proxy network (and the shared Traefik
    // container itself) have to exist before `docker compose up` runs
    // against a compose file that references them — see docker-compose.yml.
    if (!ensureTraefikStack()) {
        console.error('\nCould not bring up the shared Traefik stack — fix the issue above, then run this app\'s docker compose up manually.');
    }

    // Only meaningful for "selfsigned" — an "acme" router gets its cert
    // from Let's Encrypt instead, and never touches the shared self-signed
    // store. Registers whatever's at SSL_CERT_FILE/SSL_KEY_FILE, whether
    // that was just generated above or supplied by hand (certMode "own").
    if (resolvedTlsMode === 'selfsigned' && values.SSL_CERT_FILE && values.SSL_KEY_FILE) {
        const traefikDir = resolveTraefikDir();
        if (traefikDir) {
            const { registerCert } = require(path.join(traefikDir, 'scripts', 'register-cert.js'));
            registerCert('balancedwaypoints', values.SSL_CERT_FILE, values.SSL_KEY_FILE);
        }
    }

    if (footprint === 'minimal') {
        trimToMinimalFootprint(ROOT, FINAL_DIR, {
            mongoMode,
            tlsMode: resolvedTlsMode,
            installedVersion
        });
    } else {
        // Only reachable when !IS_SCRATCH (see the footprint calc in
        // app.post('/save')) — a checkout already at its final home, so
        // there's nothing to relocate.
        writeDeployState(FINAL_DIR, { footprint: 'full', mongoMode, installedVersion });
        bringUpDocker(FINAL_DIR, mongoMode, resolvedTlsMode);
        printAccessUrls(values.WEB_FQDN || 'localhost');
    }

    if (installPortal) {
        await installPortalNonInteractive({ webFqdn: portalWebFqdn, port: portalPort });

        // Registers this app as an SSO client of the portal and turns on
        // OIDC login — only possible when the portal's checkout is right
        // here on this host (see registerOidcClient); otherwise this is a
        // no-op and OIDC can still be wired up by hand later from the
        // portal's Admin > SSO clients.
        const portalEnv = readPortalEnv();
        if (portalEnv) {
            const appWebFqdn = values.WEB_FQDN || 'localhost';
            // Now that this app is only ever reached through Traefik on the
            // plain domain (no more raw bundled-nginx port to also
            // register), there's exactly one redirect_uri to match.
            const redirectUris = [`https://${appWebFqdn}/auth/oidc/callback`];
            const oidc = registerOidcClient('balancedwaypoints', redirectUris);
            if (oidc) {
                const portalWebFqdnActual = portalEnv.WEB_FQDN || 'localhost';
                let envText = fs.readFileSync(ENV_PATH, 'utf8');
                const overrides = {
                    OIDC_ENABLED: 'true',
                    // The portal's own raw port (5585) is no longer
                    // published to the host once it's behind Traefik too —
                    // http://...:5585/oidc would break outright.
                    OIDC_ISSUER_URL: `https://${portalWebFqdnActual}/oidc`,
                    OIDC_CLIENT_ID: oidc.clientId,
                    OIDC_CLIENT_SECRET: oidc.clientSecret,
                    OIDC_SCOPES: 'openid profile email',
                };
                for (const [key, value] of Object.entries(overrides)) {
                    const re = new RegExp(`^${key}=.*$`, 'm');
                    envText = re.test(envText) ? envText.replace(re, `${key}=${value}`) : `${envText}\n${key}=${value}\n`;
                }
                fs.writeFileSync(ENV_PATH, envText);
                console.log('\nOIDC login enabled — recreating this app\'s container to pick up the new settings...');
                if (footprint === 'minimal') {
                    run('docker', ['compose', 'up', '-d'], { cwd: FINAL_DIR });
                } else {
                    bringUpDocker(FINAL_DIR, mongoMode, resolvedTlsMode);
                }
            }
        }
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
