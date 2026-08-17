#!/usr/bin/env node
// Interactive .env setup wizard. Reads .env.example for the field list, help
// text, and defaults; serves a form on localhost; writes the result to
// FINAL_DIR/.env; generates a self-signed TLS cert if needed; then either
// trims down to a minimal Docker-only footprint or relocates the full
// checkout to FINAL_DIR (see ./lib/footprint), bringing the Docker stack up
// either way, and exits.
//
// Deliberately simpler than a from-scratch enterprise installer: Docker-only
// (no local systemd service path) — see the balancedwaypoints project plan
// for why. It does optionally wire up an existing host nginx (see
// detectHostNginx/installHostNginxSite in ./lib/bringUp) when one's
// detected running and no site for this app exists yet. Everything here can
// be done by hand instead by editing .env directly and running `docker
// compose -f docker-compose.yml -f docker-compose.nginx.yml -f
// docker-compose.mongo.yml up -d --build`.
//
// Runs against ROOT (this checkout — a scratch clone when launched via
// install.sh with --final-dir, or an existing checkout when run in place)
// and, once .env is written, either relocates that checkout to FINAL_DIR
// (the "Full checkout" footprint) or trims it down to just what's needed to
// run/update Docker and writes THAT to FINAL_DIR instead (the "Docker only,
// minimal footprint" choice — see ./lib/footprint). FINAL_DIR defaults to
// ROOT itself (no relocation) when run without --final-dir, which is what
// an in-place `./install.sh`/`node scripts/setup-wizard.js` does.
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
    detectHostNginx, installHostNginxSite, findOpenPort, isPortFree,
    readDeployState, writeDeployState, APP_PORT
} = require('./lib/bringUp');
const { relocateFullCheckout, trimToMinimalFootprint } = require('./lib/footprint');
const { detectPortal, installPortalInline } = require('./lib/portal');

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
// the "Docker only, minimal footprint" choice makes sense (see
// renderFootprintFieldset below).
const IS_SCRATCH = path.resolve(FINAL_DIR) !== path.resolve(ROOT);
// .env/certs/ are written straight to FINAL_DIR from the start (not ROOT),
// even while ROOT is still a scratch clone — that way there's no host-path
// rewriting needed afterward for either footprint: a generated cert's
// absolute path, or SSL_CERT_FILE/SSL_KEY_FILE written into .env, already
// point at FINAL_DIR from the moment they're created. See
// trimToMinimalFootprint/relocateFullCheckout in scripts/lib/footprint.js.
const ENV_PATH = path.join(FINAL_DIR, '.env');
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

const NGINX_PORT_KEYS = new Set(['NGINX_HTTP_PORT', 'NGINX_HTTPS_PORT']);

// Only offered when running against a scratch clone distinct from FINAL_DIR
// (IS_SCRATCH) — that's the only case where "delete the source afterward"
// makes sense; a checkout already at its final home has nowhere else to go.
// See relocateFullCheckout/trimToMinimalFootprint in ./lib/footprint.
function renderFootprintFieldset(footprint) {
    if (!IS_SCRATCH) {
        return `
    <fieldset>
      <legend>Installation footprint</legend>
      <p class="help">This checkout is already the install location, so the full source stays here — a
      "Docker only, minimal footprint" install is only offered the first time, via the curl install command
      (see the README).</p>
    </fieldset>`;
    }
    return `
    <fieldset>
      <legend>Installation footprint</legend>
      <div class="radio-row">
        <label><input type="radio" name="footprint" value="minimal" ${footprint !== 'full' ? 'checked' : ''} /> Docker only, minimal footprint (recommended) — builds the image, then deletes the source, leaving just what's needed to run and update the stack at <code>${escapeHtml(FINAL_DIR)}</code></label>
        <label><input type="radio" name="footprint" value="full" ${footprint === 'full' ? 'checked' : ''} /> Full checkout — keeps the source at <code>${escapeHtml(FINAL_DIR)}</code></label>
      </div>
      <p class="help">Either way, <code>update.sh</code> in the final directory is the one command to update later.</p>
    </fieldset>`;
}

function renderForm(fields, values, mongoMode, certMode, nginxInfo, portSuggestions, footprint, portalInfo) {
    // NGINX_HTTP_PORT/NGINX_HTTPS_PORT are rendered separately below (not
    // in this generic loop) — when a host nginx is running they're
    // auto-picked and hidden behind an "advanced" toggle instead of shown
    // as plain fields, which the generic per-field loop below has no
    // concept of.
    const rows = fields.filter(f => !HIDDEN_KEYS.has(f.key) && !NGINX_PORT_KEYS.has(f.key)).map(f => {
        const value = values[f.key] !== undefined ? values[f.key] : f.default;
        const isMongoOnly = MONGO_EXTERNAL_ONLY_KEYS.has(f.key);
        const disabled = isMongoOnly && mongoMode !== 'external';
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

    // The bundled Docker nginx's own ports — hidden behind an "advanced"
    // toggle and auto-picked (see computePortSuggestions) whenever a host
    // nginx is running, since that's the thing actually fronting 80/443 for
    // the domain in that case; shown normally otherwise.
    const dockerPortsHtml = `
    <fieldset>
      <legend>Docker nginx ports</legend>
      ${nginxInfo.running ? `
      <p class="help">Picked automatically (free ports on this host) since the existing nginx above will front
      this app on the standard 80/443 instead. Only change these if you know what you're doing — they still
      need to not collide with the host nginx's own ports or anything else already listening here.</p>
      <label class="checkbox-label"><input type="checkbox" id="advanced-ports-toggle" /> Advanced: customize these ports myself</label>
      ` : ''}
      <div id="docker-ports-fields" style="${nginxInfo.running ? 'display:none' : ''}">
        <div class="field">
          <label for="NGINX_HTTP_PORT">HTTP port (redirects to HTTPS)</label>
          <input type="text" id="NGINX_HTTP_PORT" name="NGINX_HTTP_PORT" value="${escapeHtml(portSuggestions.http)}" autocomplete="off" data-port-check="1" />
          <p class="help port-status" id="port-status-NGINX_HTTP_PORT" style="display:none"></p>
        </div>
        <div class="field">
          <label for="NGINX_HTTPS_PORT">HTTPS port</label>
          <input type="text" id="NGINX_HTTPS_PORT" name="NGINX_HTTPS_PORT" value="${escapeHtml(portSuggestions.https)}" autocomplete="off" data-port-check="1" />
          <p class="help port-status" id="port-status-NGINX_HTTPS_PORT" style="display:none"></p>
        </div>
      </div>
    </fieldset>`;

    // Only offered when there's actually something to offer: nginx running,
    // its config layout recognized, and no balancedwaypoints.conf already
    // there (an existing one is left alone rather than silently overwritten
    // — see detectHostNginx). Every other case gets an informational note
    // instead, no checkbox.
    const canOfferSite = nginxInfo.running && nginxInfo.canWriteSite && !nginxInfo.siteExists;
    let hostNginxHtml;
    if (canOfferSite) {
        hostNginxHtml = `
    <fieldset>
      <legend>Existing nginx</legend>
      <p class="help">nginx is already running on this host. A site can be added for it automatically — it
      becomes the public TLS terminator on the standard 80/443 for your domain (plus direct LAN-IP access on
      its own port below), reverse-proxying to the bundled Docker nginx container, which keeps terminating
      TLS internally too.</p>
      <label class="checkbox-label"><input type="checkbox" id="add-nginx-site-toggle" name="addNginxSite" value="1" /> Add an nginx site for this host's existing nginx</label>
      <div class="field" id="host-nginx-ip-port-field" style="display:none">
        <label for="HOST_NGINX_IP_PORT">Port for direct LAN-IP HTTPS access</label>
        <p class="help">nginx will also listen here so this app is reachable at
        <code>https://&lt;lan-ip&gt;:&lt;this port&gt;/</code> directly, without the domain — separate from
        the Docker nginx ports below.</p>
        <input type="text" id="HOST_NGINX_IP_PORT" name="HOST_NGINX_IP_PORT" value="${escapeHtml(portSuggestions.ip)}" autocomplete="off" data-port-check="1" />
        <p class="help port-status" id="port-status-HOST_NGINX_IP_PORT" style="display:none"></p>
      </div>
    </fieldset>`;
    } else if (nginxInfo.running && nginxInfo.siteExists) {
        hostNginxHtml = `<p class="help">A host nginx site for this app already exists — not modifying it. Edit it directly if it needs to change.</p>`;
    } else if (nginxInfo.running) {
        hostNginxHtml = `<p class="help warn">nginx is running on this host, but its config layout (expected sites-available/sites-enabled or conf.d under /etc/nginx) wasn't recognized — skipping the offer to add a site automatically. Add one by hand if needed, and make sure it isn't already bound to the Docker nginx ports below.</p>`;
    } else if (nginxInfo.installed) {
        hostNginxHtml = `<p class="help">nginx is installed but not currently running on this host — nothing to wire up.</p>`;
    } else {
        hostNginxHtml = '';
    }

    // Offers to install the Waypoints Portal (shared login across the
    // Waypoints family) right after this app's own setup finishes — but
    // only when one isn't already running on this host (see detectPortal in
    // ./lib/portal), so two portals never end up installed by accident.
    const portalHtml = portalInfo.running
        ? `<p class="help">A Waypoints Portal is already running on this host at <code>${escapeHtml(portalInfo.url)}</code> — nothing to install.</p>`
        : `<label class="checkbox-label"><input type="checkbox" name="installPortal" value="1" /> Also install the Waypoints Portal on this host, for shared login (SSO) across your Waypoints apps</label>`;

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
    ${renderFootprintFieldset(footprint)}
    ${hostNginxHtml}
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
    ${dockerPortsHtml}
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

    // "Add an nginx site" reveals the LAN-IP-access port field it needs —
    // hidden until then since it's meaningless otherwise.
    const addNginxSiteToggle = document.getElementById('add-nginx-site-toggle');
    if (addNginxSiteToggle) {
      addNginxSiteToggle.addEventListener('change', () => {
        const field = document.getElementById('host-nginx-ip-port-field');
        if (field) field.style.display = addNginxSiteToggle.checked ? '' : 'none';
      });
    }

    // "Advanced: customize these ports myself" reveals the otherwise-hidden,
    // auto-picked Docker nginx port fields for manual editing.
    const advancedPortsToggle = document.getElementById('advanced-ports-toggle');
    if (advancedPortsToggle) {
      advancedPortsToggle.addEventListener('change', () => {
        const fields = document.getElementById('docker-ports-fields');
        if (fields) fields.style.display = advancedPortsToggle.checked ? '' : 'none';
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

// Suggests starting values for the Docker nginx's own ports and the host
// nginx's LAN-IP-access port. Only actually probes for a free port when the
// relevant field hasn't already been customized away from its .env.example
// default (or, for the IP port, was never set before) — a re-run of the
// wizard against an existing .env respects whatever was already chosen
// rather than picking something new out from under it.
async function computePortSuggestions(fields, existing, nginxInfo) {
    const httpDefault = (fields.find(f => f.key === 'NGINX_HTTP_PORT') || {}).default || '80';
    const httpsDefault = (fields.find(f => f.key === 'NGINX_HTTPS_PORT') || {}).default || String(APP_PORT);
    const result = {
        http: existing.NGINX_HTTP_PORT || httpDefault,
        https: existing.NGINX_HTTPS_PORT || httpsDefault,
        ip: existing.HOST_NGINX_IP_PORT || '8443'
    };
    if (nginxInfo.running) {
        if (!existing.NGINX_HTTP_PORT || existing.NGINX_HTTP_PORT === httpDefault) {
            result.http = String(await findOpenPort(8080));
        }
        if (!existing.NGINX_HTTPS_PORT || existing.NGINX_HTTPS_PORT === httpsDefault) {
            result.https = String(await findOpenPort(Number(httpsDefault) || APP_PORT));
        }
    }
    if (!existing.HOST_NGINX_IP_PORT) {
        result.ip = String(await findOpenPort(8443));
    }
    return result;
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
        const nginxInfo = detectHostNginx();
        const portSuggestions = await computePortSuggestions(fields, existing, nginxInfo);
        const deployState = readDeployState(FINAL_DIR);
        const portalInfo = await detectPortal();
        res.send(renderForm(
            fields, existing,
            existing.mongoHost && existing.mongoHost !== 'mongo' ? 'external' : 'internal',
            existing.SSL_CERT_FILE ? 'own' : 'generate',
            nginxInfo, portSuggestions,
            deployState ? deployState.footprint : 'minimal',
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
        // Not part of .env.example/`fields` (only this wizard and a host
        // nginx site read it, never the app itself) — persisted anyway so a
        // later re-run of the wizard remembers what was already picked,
        // same as every other field above.
        if (body.HOST_NGINX_IP_PORT !== undefined) values.HOST_NGINX_IP_PORT = body.HOST_NGINX_IP_PORT;

        // Forced to 'full' whenever this isn't a scratch clone — there's no
        // footprint radio rendered in that case (see renderFootprintFieldset),
        // so any submitted value here would be meaningless.
        const footprint = IS_SCRATCH ? (body.footprint === 'full' ? 'full' : 'minimal') : 'full';

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
        resolveDone({ mongoMode, values, footprint, addNginxSite: body.addNginxSite === '1', installPortal: body.installPortal === '1' });
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

    const { mongoMode, values, footprint, addNginxSite, installPortal } = await done;
    server.close();

    let installedVersion = 'unknown';
    try {
        installedVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    } catch { /* leave as 'unknown' */ }

    if (footprint === 'minimal') {
        trimToMinimalFootprint(ROOT, FINAL_DIR, {
            mongoMode,
            nginxHttpsPort: values.NGINX_HTTPS_PORT || APP_PORT,
            nginxHttpPort: values.NGINX_HTTP_PORT || '80',
            installedVersion
        });
    } else {
        if (IS_SCRATCH) relocateFullCheckout(ROOT, FINAL_DIR);
        writeDeployState(FINAL_DIR, { footprint: 'full', mongoMode, installedVersion });
        bringUpDocker(FINAL_DIR, mongoMode);
        printAccessUrls(values.WEB_FQDN || 'localhost', values.NGINX_HTTPS_PORT || APP_PORT);
    }

    if (addNginxSite) {
        installHostNginxSite(values.WEB_FQDN, values.HOST_NGINX_IP_PORT || '8443', values.NGINX_HTTPS_PORT || APP_PORT, values.SSL_CERT_FILE, values.SSL_KEY_FILE);
    }

    if (installPortal) installPortalInline();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
