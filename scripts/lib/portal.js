// Detects a Waypoints Portal already running on this host, so the setup
// wizard can avoid offering a second install of it, and installs one
// non-interactively when none is found — see the "Waypoints Portal"
// fieldset and its handling in setup-wizard.js. Non-interactive: this
// clones the portal repo, writes its .env directly from the couple of
// values this wizard already collected (domain/port), and brings its
// Docker stack up itself — the portal's own setup wizard never opens, so
// installing it doesn't hand control off to a second browser form.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PORTAL_DEFAULT_PORT = 5585;
// Same override convention as this app's own install.sh (REPO_URL/REPO_REF/
// INSTALL_DIR) — lets all of this be pointed at a local Gitea (or any other)
// mirror for testing.
const PORTAL_REPO_URL = process.env.PORTAL_REPO_URL || 'https://github.com/j5guy/waypointsportal.git';
const PORTAL_REPO_REF = process.env.PORTAL_REPO_REF || '';
const PORTAL_INSTALL_DIR = process.env.PORTAL_INSTALL_DIR || '/opt/waypointsportal';

// Any locally running container whose image/name mentions the portal —
// covers a custom-ported install (docker ps reports the actual published
// port even when it isn't 5585). Docker not being installed/running just
// yields no candidates, which is fine: the default-port probe in
// detectPortal below still catches a manually-run (non-Docker) portal.
function dockerPortalCandidatePorts() {
    const result = spawnSync('docker', ['ps', '--format', '{{.Image}}\t{{.Names}}\t{{.Ports}}'], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout) return [];
    const ports = [];
    for (const line of result.stdout.split('\n')) {
        if (!/waypointsportal/i.test(line)) continue;
        for (const m of line.matchAll(/:(\d+)->/g)) ports.push(Number(m[1]));
    }
    return ports;
}

// Confirms a candidate port is actually the portal (not just some other
// service that happens to be listening there) via its identifying health
// response — see the `app` field in waypointsportal/routes/health.js.
function checkPortalHealth(port, timeoutMs = 800) {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body).app === 'waypointsportal');
                } catch {
                    resolve(false);
                }
            });
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

async function detectPortal() {
    const candidates = [...new Set([...dockerPortalCandidatePorts(), PORTAL_DEFAULT_PORT])];
    for (const port of candidates) {
        if (await checkPortalHealth(port)) return { running: true, port, url: `http://localhost:${port}/` };
    }
    return { running: false };
}

function run(cmd, args, opts = {}) {
    const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
    return result.status === 0;
}

// Clones the portal (if PORTAL_INSTALL_DIR doesn't already have a
// checkout), writes its .env directly from its own .env.example — filling
// in only WEB_FQDN/PORT/sessionSecret/mongoHost, leaving everything else
// (LDAP/OIDC, ADMIN_EMAIL, etc.) at .env.example's own defaults, same as a
// fresh manual install would; all configurable later from Admin > LDAP/OIDC
// without a redeploy — then brings its Docker stack up. No interactive
// wizard involved at any point.
async function installPortalNonInteractive({ webFqdn, port }) {
    console.log('\n== Installing the Waypoints Portal ==');

    // Re-checked right here, not just when the form was first rendered — a
    // portal could have been installed by a concurrent process/another
    // sibling app's wizard in the time since, and this is the last point
    // before actually provisioning a second one.
    const already = await detectPortal();
    if (!already.running) {
        if (!fs.existsSync(path.join(PORTAL_INSTALL_DIR, 'docker-compose.yml'))) {
            // A non-empty PORTAL_INSTALL_DIR without a docker-compose.yml can
            // only be a previous attempt that didn't finish (this path is
            // never used for anything else) — clear it so `git clone` has an
            // empty target instead of failing on it.
            if (fs.existsSync(PORTAL_INSTALL_DIR) && fs.readdirSync(PORTAL_INSTALL_DIR).length > 0) {
                console.log(`${PORTAL_INSTALL_DIR} exists but looks like an incomplete previous attempt — clearing it and retrying...`);
                run('sudo', ['rm', '-rf', PORTAL_INSTALL_DIR]);
            }
            console.log(`Cloning ${PORTAL_REPO_URL} into ${PORTAL_INSTALL_DIR}...`);
            if (!fs.existsSync(PORTAL_INSTALL_DIR)) {
                if (!run('sudo', ['mkdir', '-p', PORTAL_INSTALL_DIR])) {
                    console.error(`Failed to create ${PORTAL_INSTALL_DIR} — install the portal manually later: https://github.com/j5guy/waypointsportal`);
                    return;
                }
                run('sudo', ['chown', `${os.userInfo().username}:${os.userInfo().username}`, PORTAL_INSTALL_DIR]);
            }
            const cloneArgs = ['clone', '--depth', '1'];
            if (PORTAL_REPO_REF) cloneArgs.push('--branch', PORTAL_REPO_REF);
            cloneArgs.push(PORTAL_REPO_URL, PORTAL_INSTALL_DIR);
            // cwd explicitly set (not inherited) — this can run after a
            // minimal-footprint install has already deleted this process's
            // original scratch-checkout cwd, which would otherwise make git
            // fail its own getcwd() at startup. GIT_TERMINAL_PROMPT=0 makes a
            // repo that needs auth fail immediately with a clear error
            // instead of silently hanging this non-interactive install
            // waiting on a username/password prompt nothing will ever answer.
            if (!run('git', cloneArgs, { cwd: os.tmpdir(), env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })) {
                console.error(`Portal clone failed (auth required, or ${PORTAL_REPO_URL} is unreachable?) — install it manually later: https://github.com/j5guy/waypointsportal`);
                return;
            }
        } else {
            console.log(`${PORTAL_INSTALL_DIR} already has a checkout — using it as-is.`);
        }

        const envPath = path.join(PORTAL_INSTALL_DIR, '.env');
        if (!fs.existsSync(envPath)) {
            let envText = fs.readFileSync(path.join(PORTAL_INSTALL_DIR, '.env.example'), 'utf8');
            const overrides = {
                WEB_FQDN: webFqdn || 'localhost',
                PORT: String(port || PORTAL_DEFAULT_PORT),
                sessionSecret: crypto.randomBytes(64).toString('hex'),
                mongoHost: 'mongo',
                TLS_MODE: 'auto',
            };
            for (const [key, value] of Object.entries(overrides)) {
                const re = new RegExp(`^${key}=.*$`, 'm');
                envText = re.test(envText) ? envText.replace(re, `${key}=${value}`) : `${envText}\n${key}=${value}\n`;
            }
            fs.writeFileSync(envPath, envText, { mode: 0o600 });
        } else {
            console.log(`${envPath} already exists — leaving it as-is.`);
        }

        console.log('\n== Bringing up the portal Docker stack ==');
        if (!run('docker', ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.mongo.yml', 'up', '-d', '--build'], { cwd: PORTAL_INSTALL_DIR })) {
            console.error(`\ndocker compose up failed for the portal — see output above. Fix the issue, then run it yourself:\n  cd ${PORTAL_INSTALL_DIR} && docker compose -f docker-compose.yml -f docker-compose.mongo.yml up -d --build`);
            return;
        }
        console.log(`\nPortal is up — visit it and sign up; the first account created becomes the portal admin.`);
    } else {
        console.log(`A Waypoints Portal is already running at ${already.url} — skipping install.`);
    }

    // Always attempted, whether the portal was just installed above or was
    // already running — idempotent (only fills in .env keys that are
    // actually missing, only re-registers a cert when needed) and
    // self-healing (e.g. the shared Traefik stack needs bringing back up
    // after the portal already existed). See ensurePortalTraefikLabels'
    // own doc comment above for why this is needed at all.
    const portalEnv = readPortalEnv();
    const finalWebFqdn = (portalEnv && portalEnv.WEB_FQDN) || overrideOrLocalhost(webFqdn);
    ensurePortalTraefikLabels(finalWebFqdn, (portalEnv && portalEnv.TLS_MODE) || 'auto');
}

function overrideOrLocalhost(webFqdn) {
    return webFqdn && webFqdn.trim() ? webFqdn.trim() : 'localhost';
}

function commandExistsLocal(cmd) {
    return !spawnSync(cmd, ['--version'], { stdio: 'ignore' }).error;
}

// Same env-overridable convention as PORTAL_REPO_URL/PORTAL_INSTALL_DIR
// above, duplicated here rather than imported from ./bringUp.js — this file
// already stands entirely on its own (never requires ./bringUp.js, even
// though setup-wizard.js requires both as siblings), so a small local copy
// of the traefik-dir lookup stays consistent with that.
const TRAEFIK_REPO_URL = process.env.TRAEFIK_REPO_URL || 'https://github.com/j5guy/allthewaypoints.git';
const TRAEFIK_REPO_REF = process.env.TRAEFIK_REPO_REF || '';
const TRAEFIK_INSTALL_DIR = process.env.TRAEFIK_INSTALL_DIR || '/opt/waypoints-traefik';

// See the identical function/comment in ./bringUp.js — duplicated rather
// than imported, per this file's existing "stands on its own" convention.
function resolveTraefikDirForPortal() {
    const siblingDir = path.resolve(__dirname, '..', '..', '..', 'traefik');
    if (fs.existsSync(path.join(siblingDir, 'docker-compose.yml'))) return siblingDir;

    const clonedDir = path.join(TRAEFIK_INSTALL_DIR, 'traefik');
    if (fs.existsSync(path.join(clonedDir, 'docker-compose.yml'))) return clonedDir;

    console.log('\n== Fetching the shared Traefik stack ==');
    if (!fs.existsSync(TRAEFIK_INSTALL_DIR)) {
        if (!run('sudo', ['mkdir', '-p', TRAEFIK_INSTALL_DIR])) {
            console.error(`Failed to create ${TRAEFIK_INSTALL_DIR} — bring up the shared Traefik stack manually: https://github.com/j5guy/allthewaypoints`);
            return null;
        }
        run('sudo', ['chown', `${os.userInfo().username}:${os.userInfo().username}`, TRAEFIK_INSTALL_DIR]);
    }
    const cloneArgs = ['clone', '--depth', '1'];
    if (TRAEFIK_REPO_REF) cloneArgs.push('--branch', TRAEFIK_REPO_REF);
    cloneArgs.push(TRAEFIK_REPO_URL, TRAEFIK_INSTALL_DIR);
    if (!run('git', cloneArgs, { cwd: os.tmpdir(), env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })) {
        console.error(`Traefik clone failed (auth required, or ${TRAEFIK_REPO_URL} is unreachable?) — bring up the shared Traefik stack manually: https://github.com/j5guy/allthewaypoints`);
        return null;
    }
    return clonedDir;
}

// A plain self-signed cert (no local CA — simpler than the product apps'
// own generateCert in ./bringUp.js, since this is only ever used to
// register one cert with the shared Traefik store, never reissued/reused
// beyond that) for the portal — it has no bringUp.js of its own to borrow
// generateCert from, and no TLS/cert concept of its own either.
function generatePortalCert(webFqdn) {
    if (!commandExistsLocal('openssl')) {
        console.error('openssl not found on this host — skipping the certificate for the portal.');
        return null;
    }
    const certsDir = path.join(PORTAL_INSTALL_DIR, 'certs');
    fs.mkdirSync(certsDir, { recursive: true });
    const certPath = path.join(certsDir, 'cert.pem');
    const keyPath = path.join(certsDir, 'cert.key');
    const result = spawnSync('openssl', [
        'req', '-x509', '-nodes', '-newkey', 'rsa:2048',
        '-keyout', keyPath, '-out', certPath,
        '-days', '825', '-subj', `/CN=${webFqdn}`,
    ], { stdio: 'inherit' });
    if (result.status !== 0) return null;
    return { certPath, keyPath };
}

// Always attempted, whether the portal was just installed above or was
// already running — idempotent (only writes .env keys that are actually
// missing, only re-registers a cert when tlsMode is selfsigned) and
// self-healing (e.g. the shared Traefik stack got taken down and needs
// bringing back up after the portal already existed). The portal has no
// bundled nginx of its own (unlike the product apps), so without this it's
// only ever reachable at its raw Docker-published port over plain HTTP —
// never by FQDN, and never over HTTPS. Mirrors ensureTraefikStack/
// resolveTlsMode in ./bringUp.js, duplicated rather than imported per this
// file's existing convention (see resolveTraefikDirForPortal above).
function ensurePortalTraefikLabels(finalWebFqdn, explicitTlsMode) {
    const traefikDir = resolveTraefikDirForPortal();
    if (!traefikDir) return;
    const { ensureStack } = require(path.join(traefikDir, 'scripts', 'ensure-stack.js'));
    if (!ensureStack(traefikDir)) return;
    const { resolveTlsMode } = require(path.join(traefikDir, 'scripts', 'tls-mode.js'));
    const tlsMode = resolveTlsMode(finalWebFqdn, explicitTlsMode);

    const envPath = path.join(PORTAL_INSTALL_DIR, '.env');
    if (fs.existsSync(envPath)) {
        let envText = fs.readFileSync(envPath, 'utf8');
        const overrides = {};
        if (!/^WEB_FQDN=.+$/m.test(envText)) overrides.WEB_FQDN = finalWebFqdn;
        if (!/^TLS_MODE=.+$/m.test(envText)) overrides.TLS_MODE = tlsMode;
        for (const [key, value] of Object.entries(overrides)) {
            const re = new RegExp(`^${key}=.*$`, 'm');
            envText = re.test(envText) ? envText.replace(re, `${key}=${value}`) : `${envText}\n${key}=${value}\n`;
        }
        if (Object.keys(overrides).length) fs.writeFileSync(envPath, envText, { mode: 0o600 });

        // Picks up any .env change just made above (WEB_FQDN feeds the
        // Traefik router's Host() label at compose-interpolation time) —
        // labels themselves live in the portal's own docker-compose.yml,
        // not here.
        run('docker', ['compose', '-f', 'docker-compose.yml', 'up', '-d'], { cwd: PORTAL_INSTALL_DIR });
    }

    if (tlsMode === 'selfsigned') {
        const cert = generatePortalCert(finalWebFqdn);
        if (cert) {
            const { registerCert } = require(path.join(traefikDir, 'scripts', 'register-cert.js'));
            registerCert('waypointsportal', cert.certPath, cert.keyPath);
        } else {
            console.error("Couldn't generate a certificate for the portal — add one manually and register it with the shared Traefik stack if you want HTTPS access to it.");
        }
    }
}

// Reads the portal's own .env directly off disk (same host, co-located at
// PORTAL_INSTALL_DIR) rather than guessing at its WEB_FQDN/PORT — reliable
// whether the portal was just installed by installPortalNonInteractive above
// or was already running from some earlier install.
function readPortalEnv() {
    const envPath = path.join(PORTAL_INSTALL_DIR, '.env');
    if (!fs.existsSync(envPath)) return null;
    const values = {};
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (m) values[m[1]] = m[2];
    }
    return values;
}

// Registers this app as an SSO client of the portal's OIDC provider —
// headless equivalent of the portal's Admin > SSO clients, via its own
// `npm run create-oidc-client` script run inside its container (see
// waypointsportal/scripts/createOidcClient.js). Only possible when the
// portal's checkout is right here on this host (needed for `docker compose
// exec`) — when it isn't (a portal running on a different host, or set up
// some other way), this returns null and the caller falls back to printing
// manual instructions instead.
function registerOidcClient(appSlug, redirectUris) {
    if (!fs.existsSync(path.join(PORTAL_INSTALL_DIR, 'docker-compose.yml'))) return null;
    console.log(`\n== Registering "${appSlug}" as an SSO client of the portal ==`);
    const result = spawnSync(
        'docker', ['compose', 'exec', '-T', 'app', 'node', 'scripts/createOidcClient.js', appSlug, ...redirectUris],
        { cwd: PORTAL_INSTALL_DIR, encoding: 'utf8' }
    );
    if (result.status !== 0) {
        console.error(`Couldn't register this app as an SSO client automatically:\n${result.stderr || result.stdout || ''}`);
        return null;
    }
    console.log(result.stdout);
    const idMatch = result.stdout.match(/OIDC_CLIENT_ID=(\S+)/);
    const secretMatch = result.stdout.match(/OIDC_CLIENT_SECRET=(\S+)/);
    if (!idMatch || !secretMatch) {
        console.error("Registration succeeded but the client ID/secret couldn't be parsed from the portal's output — link this app manually from the portal's Admin > SSO clients.");
        return null;
    }
    return { clientId: idMatch[1], clientSecret: secretMatch[1] };
}

module.exports = { detectPortal, installPortalNonInteractive, readPortalEnv, registerOidcClient };
