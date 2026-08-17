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

const PORTAL_DEFAULT_PORT = 5580;
// Same override convention as this app's own install.sh (REPO_URL/REPO_REF/
// INSTALL_DIR) — lets all of this be pointed at a local Gitea (or any other)
// mirror for testing.
const PORTAL_REPO_URL = process.env.PORTAL_REPO_URL || 'https://github.com/j5guy/waypointsportal.git';
const PORTAL_REPO_REF = process.env.PORTAL_REPO_REF || '';
const PORTAL_INSTALL_DIR = process.env.PORTAL_INSTALL_DIR || '/opt/waypointsportal';

// Any locally running container whose image/name mentions the portal —
// covers a custom-ported install (docker ps reports the actual published
// port even when it isn't 5580). Docker not being installed/running just
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
function installPortalNonInteractive({ webFqdn, port }) {
    console.log('\n== Installing the Waypoints Portal ==');

    // Re-checked right here, not just when the form was first rendered — a
    // portal could have been installed by a concurrent process/another
    // sibling app's wizard in the time since, and this is the last point
    // before actually provisioning a second one.
    return detectPortal().then((already) => {
        if (already.running) {
            console.log(`A Waypoints Portal is already running at ${already.url} — skipping install.`);
            return;
        }

        if (!fs.existsSync(path.join(PORTAL_INSTALL_DIR, 'docker-compose.yml'))) {
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
            // fail its own getcwd() at startup.
            if (!run('git', cloneArgs, { cwd: os.tmpdir() })) {
                console.error('Portal clone failed — install it manually later: https://github.com/j5guy/waypointsportal');
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
        console.log(`\nPortal is up: http://${overrideOrLocalhost(webFqdn)}:${port || PORTAL_DEFAULT_PORT}/ — visit it and sign up; the first account created becomes the portal admin.`);
    });
}

function overrideOrLocalhost(webFqdn) {
    return webFqdn && webFqdn.trim() ? webFqdn.trim() : 'localhost';
}

module.exports = { detectPortal, installPortalNonInteractive };
