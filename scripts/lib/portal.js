// Detects a Waypoints Portal already running on this host, so the setup
// wizard can avoid offering a second install of it, and offers to install
// it inline when none is found — see the "Waypoints Portal" fieldset and
// its handling in setup-wizard.js.
const http = require('http');
const { spawnSync } = require('child_process');

const PORTAL_DEFAULT_PORT = 5580;
// Overridable so this can be pointed at a local Gitea (or any other) mirror
// for testing — e.g. PORTAL_INSTALL_URL=http://gitea.local/me/waypointsportal/raw/branch/main/install.sh
const PORTAL_INSTALL_URL = process.env.PORTAL_INSTALL_URL || 'https://raw.githubusercontent.com/j5guy/waypointsportal/master/install.sh';

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

// Shells out to the portal's own curl-pipeable installer (the same
// one-liner documented in its README) instead of duplicating its own
// clone/.env/docker-compose logic here. Runs in the foreground — the
// portal's setup wizard needs the same interactive terminal this wizard is
// already running in (it prints a URL to open, and waits on Enter before
// continuing).
function installPortalInline() {
    console.log('\n== Installing the Waypoints Portal ==');
    const result = spawnSync('bash', ['-c', `curl -fsSL ${PORTAL_INSTALL_URL} | bash`], { stdio: 'inherit' });
    if (result.status !== 0) {
        console.error(`\nPortal install failed or was interrupted — run it yourself later:\n  curl -fsSL ${PORTAL_INSTALL_URL} | bash`);
    }
}

module.exports = { detectPortal, installPortalInline };
