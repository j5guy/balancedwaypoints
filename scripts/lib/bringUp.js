// Shared "actually bring the app up" logic — Docker compose invocation and
// TLS cert generation. Docker-only by design (see the plan note in
// setup-wizard.js) — no local-systemd-service path. Reachability over
// HTTPS comes from joining the shared Traefik reverse proxy (see
// ensureTraefikStack/resolveTlsMode below) rather than a bundled nginx
// sidecar or a hand-wired host nginx site — one shared proxy, routed
// entirely by Docker labels (see docker-compose.yml). Extracted out of
// setup-wizard.js so scripts/update.js and scripts/lib/footprint.js can
// reuse the same bringUpDocker/deploy-state helpers.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');
const { lanAddresses } = require('./network');

// Fixed, not user-configurable (see config/config.js) — the container only
// ever exposes this port internally (see docker-compose.yml's `expose`);
// Traefik is what actually terminates TLS and routes 443 to it by label.
const APP_PORT = 5570;

// Last 4.4.x release before MongoDB added the ARMv8.2-A CPU requirement —
// fallback for hardware that can't run anything newer (e.g. Raspberry Pi 4
// and earlier).
const LEGACY_ARM_MONGO_IMAGE = 'mongo:4.4.18';

function commandExists(cmd) {
    const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    return !result.error;
}

// Probes by actually attempting to bind the port (catches anything already
// using it, whatever it is — not just a well-known list), trying the next
// one up on failure. Used both to suggest a starting default and to back
// the setup form's live /check-port endpoint.
function findOpenPort(start) {
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => {
            resolve(findOpenPort(start + 1));
        });
        probe.listen(start, '0.0.0.0', () => {
            probe.close(() => resolve(start));
        });
    });
}

// Same probe, without the "keep trying the next port" fallback — just
// reports whether this exact port is free right now, for the live per-field
// check.
function isPortFree(port) {
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => resolve(false));
        probe.listen(port, '0.0.0.0', () => probe.close(() => resolve(true)));
    });
}

// Env-overridable, same convention as this app's own install.sh (REPO_URL/
// REPO_REF/INSTALL_DIR) — TRAEFIK_INSTALL_DIR is where a standalone copy of
// the shared traefik/ stack gets cloned to on hosts where this app isn't
// sitting inside a full allthewaypoints checkout (see resolveTraefikDir).
const TRAEFIK_REPO_URL = process.env.TRAEFIK_REPO_URL || 'https://github.com/j5guy/allthewaypoints.git';
const TRAEFIK_REPO_REF = process.env.TRAEFIK_REPO_REF || '';
const TRAEFIK_INSTALL_DIR = process.env.TRAEFIK_INSTALL_DIR || '/opt/waypoints-traefik';

// Locates the traefik/ checkout this app should join: normally the sibling
// directory right next to this one (../traefik — true for a full monorepo
// checkout, and for every local dev/test setup), cloning a standalone copy
// to TRAEFIK_INSTALL_DIR on demand otherwise (a single-app install that
// isn't sitting inside a full allthewaypoints checkout) — same on-demand
// clone pattern installPortalNonInteractive in ./portal.js already uses for
// the portal repo. traefik/ is a subdirectory of the allthewaypoints
// monorepo, not its own repo, so the clone target is TRAEFIK_INSTALL_DIR
// itself, with the actual compose stack living at its traefik/ subpath.
function resolveTraefikDir() {
    const siblingDir = path.resolve(__dirname, '..', '..', '..', 'traefik');
    if (fs.existsSync(path.join(siblingDir, 'docker-compose.yml'))) return siblingDir;

    const clonedDir = path.join(TRAEFIK_INSTALL_DIR, 'traefik');
    if (fs.existsSync(path.join(clonedDir, 'docker-compose.yml'))) return clonedDir;

    console.log(`\n== Fetching the shared Traefik stack ==`);
    if (!fs.existsSync(TRAEFIK_INSTALL_DIR)) {
        if (!run('sudo', ['mkdir', '-p', TRAEFIK_INSTALL_DIR])) {
            console.error(`Failed to create ${TRAEFIK_INSTALL_DIR} — bring up the shared Traefik stack manually: https://github.com/j5guy/allthewaypoints`);
            return null;
        }
        run('sudo', ['chown', `${os.userInfo().username}:${os.userInfo().username}`, TRAEFIK_INSTALL_DIR]);
    } else if (fs.readdirSync(TRAEFIK_INSTALL_DIR).length > 0) {
        // Non-empty without the expected traefik/ subpath — only a previous
        // failed attempt ever leaves this directory in that state, so clear
        // it rather than fail `git clone` on a non-empty target.
        console.log(`${TRAEFIK_INSTALL_DIR} exists but looks like an incomplete previous attempt — clearing it and retrying...`);
        run('sudo', ['rm', '-rf', TRAEFIK_INSTALL_DIR]);
        run('sudo', ['mkdir', '-p', TRAEFIK_INSTALL_DIR]);
        run('sudo', ['chown', `${os.userInfo().username}:${os.userInfo().username}`, TRAEFIK_INSTALL_DIR]);
    }

    const cloneArgs = ['clone', '--depth', '1'];
    if (TRAEFIK_REPO_REF) cloneArgs.push('--branch', TRAEFIK_REPO_REF);
    cloneArgs.push(TRAEFIK_REPO_URL, TRAEFIK_INSTALL_DIR);
    // cwd explicitly set (not inherited), same reasoning as the portal
    // clone in ./portal.js — this can run after a minimal-footprint install
    // has already deleted this process's original scratch-checkout cwd.
    if (!run('git', cloneArgs, { cwd: os.tmpdir(), env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })) {
        console.error(`Traefik clone failed (auth required, or ${TRAEFIK_REPO_URL} is unreachable?) — bring up the shared Traefik stack manually: https://github.com/j5guy/allthewaypoints`);
        return null;
    }
    return clonedDir;
}

// Idempotent "join the shared Traefik proxy" step — ensures the external
// waypoints-proxy network and the shared Traefik container both exist,
// cloning traefik/ first if this host doesn't already have a copy. Called
// right before bringUpDocker (see setup-wizard.js) since the external
// network has to exist before `docker compose up` runs against a compose
// file that references it.
function ensureTraefikStack() {
    const traefikDir = resolveTraefikDir();
    if (!traefikDir) return false;
    const { ensureStack } = require(path.join(traefikDir, 'scripts', 'ensure-stack.js'));
    return ensureStack(traefikDir);
}

// Wraps the shared TLS_MODE heuristic (traefik/scripts/tls-mode.js) so
// callers here don't need to know where the traefik/ checkout lives. Falls
// back to "selfsigned" (never silently attempts ACME) if the traefik/
// checkout couldn't be resolved/cloned — resolveTraefikDir has already
// logged why.
function resolveTlsMode(webFqdn, explicitOverride) {
    const traefikDir = resolveTraefikDir();
    if (!traefikDir) {
        return explicitOverride === 'acme' || explicitOverride === 'selfsigned' ? explicitOverride : 'selfsigned';
    }
    const { resolveTlsMode: resolve } = require(path.join(traefikDir, 'scripts', 'tls-mode.js'));
    return resolve(webFqdn, explicitOverride);
}

function run(cmd, args, opts = {}) {
    console.log(`\n$ ${cmd} ${args.join(' ')}`);
    const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
    return result.status === 0;
}

// Practical proxy for MongoDB's "ARMv8.2-A or higher" requirement — see the
// equivalent check in fondwaypoints/workouts for the full rationale. Fails
// open (use the default image) on anything inconclusive.
function mongoNeedsLegacyArmImage() {
    if (process.platform !== 'linux') return false;
    if (process.arch !== 'arm64' && process.arch !== 'arm') return false;
    try {
        return !fs.readFileSync('/proc/cpuinfo', 'utf8').includes('atomics');
    } catch {
        return false;
    }
}

function buildSanList(webFqdn) {
    const sans = [];
    const seen = new Set();
    const add = (entry) => { if (!seen.has(entry)) { seen.add(entry); sans.push(entry); } };

    if (net.isIP(webFqdn)) add(`IP:${webFqdn}`);
    else add(`DNS:${webFqdn}`);
    for (const addr of lanAddresses()) add(`IP:${addr}`);
    add('DNS:localhost');
    add('IP:127.0.0.1');
    return sans;
}

// Generates (or reuses) a local CA, then issues a leaf certificate for
// webFqdn signed by it, under <rootDir>/certs.
function generateCert(rootDir, webFqdn) {
    if (spawnSync('openssl', ['version'], { stdio: 'ignore' }).error) {
        return { ok: false, message: 'openssl was not found on PATH. Install it, or provide your own SSL_CERT_FILE/SSL_KEY_FILE in .env.' };
    }

    const certsDir = path.join(rootDir, 'certs');
    fs.mkdirSync(certsDir, { recursive: true });
    const caKeyPath = path.join(certsDir, 'ca.key');
    const caCertPath = path.join(certsDir, 'ca.pem');
    const certKeyPath = path.join(certsDir, 'cert.key');
    const certPath = path.join(certsDir, 'cert.pem');
    const csrPath = path.join(certsDir, 'cert.csr');
    const extPath = path.join(certsDir, 'cert.ext');

    if (!fs.existsSync(caKeyPath) || !fs.existsSync(caCertPath)) {
        console.log('\nGenerating local CA (certs/ca.pem)...');
        const genCa = spawnSync('openssl', [
            'req', '-x509', '-newkey', 'rsa:4096', '-sha256', '-days', '3650', '-nodes',
            '-keyout', caKeyPath, '-out', caCertPath,
            '-subj', '/CN=Balanced Waypoints Local CA'
        ], { stdio: 'inherit' });
        if (genCa.status !== 0) return { ok: false, message: 'Failed to generate the local CA — see terminal output.' };
    } else {
        console.log('\nReusing existing local CA (certs/ca.pem)...');
    }

    console.log(`\nIssuing a certificate for ${webFqdn} (certs/cert.pem)...`);
    fs.writeFileSync(extPath, `subjectAltName=${buildSanList(webFqdn).join(',')}\n`);

    const genKey = spawnSync('openssl', [
        'req', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', certKeyPath, '-out', csrPath,
        '-subj', `/CN=${webFqdn}`
    ], { stdio: 'inherit' });
    if (genKey.status !== 0) return { ok: false, message: 'Failed to generate the certificate key/CSR — see terminal output.' };

    const signCert = spawnSync('openssl', [
        'x509', '-req', '-in', csrPath,
        '-CA', caCertPath, '-CAkey', caKeyPath, '-CAcreateserial',
        '-out', certPath, '-days', '825', '-sha256', '-extfile', extPath
    ], { stdio: 'inherit' });
    if (signCert.status !== 0) return { ok: false, message: 'Failed to sign the certificate — see terminal output.' };

    return { ok: true, certPath, keyPath: certKeyPath, caCertPem: fs.readFileSync(caCertPath, 'utf8') };
}

function ensureDockerInstalled() {
    if (commandExists('docker')) return true;

    console.log('\nDocker not found. Attempting to install...');

    let distroId = '';
    try {
        const match = fs.readFileSync('/etc/os-release', 'utf8').match(/^ID="?([^"\n]*)"?$/m);
        distroId = match ? match[1] : '';
    } catch { /* no /etc/os-release — not this distro family */ }

    let ok;
    if (distroId === 'rocky') {
        // get.docker.com resolves Rocky to download.docker.com/linux/rocky/docker-ce.repo, which
        // Docker only publishes a near-empty stub of (missing docker-ce/docker-ce-cli/
        // docker-ce-rootless-extras). The rhel path has the full package set and works fine on
        // Rocky, so set the repo up against that directly instead of using the convenience script.
        ok = run('sudo', ['dnf', '-y', '-q', 'install', 'dnf-plugins-core'])
            && run('sudo', ['rm', '-f', '/etc/yum.repos.d/docker-ce.repo', '/etc/yum.repos.d/docker-ce-staging.repo'])
            && run('sudo', ['dnf', 'config-manager', '--add-repo', 'https://download.docker.com/linux/rhel/docker-ce.repo'])
            && run('sudo', ['dnf', '-y', '-q', '--best', 'install', 'docker-ce', 'docker-ce-cli', 'containerd.io', 'docker-compose-plugin', 'docker-ce-rootless-extras', 'docker-buildx-plugin']);
    } else {
        if (spawnSync('curl', ['--version'], { stdio: 'ignore' }).error) {
            console.log('curl not found — installing it first...');
            if (commandExists('apt-get')) { run('sudo', ['apt-get', 'update']); run('sudo', ['apt-get', 'install', '-y', 'curl']); }
            else if (commandExists('dnf')) run('sudo', ['dnf', 'install', '-y', 'curl']);
            else if (commandExists('yum')) run('sudo', ['yum', 'install', '-y', 'curl']);
        }
        ok = spawnSync('sh', ['-c', 'curl -fsSL https://get.docker.com | sudo sh'], { stdio: 'inherit' }).status === 0;
    }

    if (!ok) {
        console.error('\nDocker auto-install failed — install manually: https://docs.docker.com/engine/install/');
        return false;
    }
    run('sudo', ['systemctl', 'enable', '--now', 'docker']);
    try {
        run('sudo', ['usermod', '-aG', 'docker', os.userInfo().username]);
        console.log("Docker installed. If you're not running as root, log out/in (or run 'newgrp docker') before using docker without sudo.");
    } catch { /* best effort */ }
    return true;
}

// Brings up the Docker stack from rootDir. mongoMode is 'internal' (bundled
// mongo container) or 'external' (points at mongoHost in .env already).
// tlsMode is the already-resolved 'acme' | 'selfsigned' (see
// resolveTlsMode above) — 'acme' layers on docker-compose.tls-acme.yml,
// which adds the Traefik router's Let's Encrypt cert resolver label;
// 'selfsigned' needs no extra compose file, just a cert registered with the
// shared Traefik stack (see registerCert in setup-wizard.js).
function bringUpDocker(rootDir, mongoMode, tlsMode) {
    const composeFiles = ['-f', 'docker-compose.yml'];
    if (mongoMode === 'internal') composeFiles.push('-f', 'docker-compose.mongo.yml');
    if (tlsMode === 'acme') composeFiles.push('-f', 'docker-compose.tls-acme.yml');
    const composeCmd = `docker compose ${composeFiles.join(' ')} up -d --build`;

    if (!ensureDockerInstalled()) {
        console.error(`\nInstall Docker manually, then run: ${composeCmd}`);
        process.exit(1);
    }
    if (spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status !== 0) {
        console.error(`\ndocker compose (v2 plugin) is not available. Install it, then run: ${composeCmd}`);
        process.exit(1);
    }

    console.log(`\n== Bringing up the Docker stack (MongoDB: ${mongoMode}) ==`);
    if (!run('docker', ['compose', ...composeFiles, 'up', '-d', '--build'], { cwd: rootDir })) {
        console.error('\ndocker compose up failed — see output above.');
        process.exit(1);
    }
    console.log(`\nDone. Check status with: docker compose ${composeFiles.join(' ')} ps`);
}

// Records what a given install directory actually is (full checkout vs.
// minimal footprint, which MongoDB mode, what version) — written by
// setup-wizard.js on install and scripts/update.js on every update.
// update.sh's own bash (not Node) reads the `footprint` field out of this
// via a plain sed one-liner before it even knows whether Node is installed
// on this host, so this needs to stay flat, pretty-printed JSON — never
// nested — to keep that extraction reliable.
function readDeployState(rootDir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(rootDir, '.deploy-state.json'), 'utf8'));
    } catch {
        return null;
    }
}

function writeDeployState(rootDir, state) {
    fs.writeFileSync(path.join(rootDir, '.deploy-state.json'), JSON.stringify(state, null, 2));
}

module.exports = {
    APP_PORT,
    LEGACY_ARM_MONGO_IMAGE,
    mongoNeedsLegacyArmImage,
    commandExists,
    resolveTraefikDir,
    ensureTraefikStack,
    resolveTlsMode,
    findOpenPort,
    isPortFree,
    run,
    generateCert,
    buildSanList,
    ensureDockerInstalled,
    bringUpDocker,
    readDeployState,
    writeDeployState
};
