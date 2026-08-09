// Shared "actually bring the app up" logic — Docker compose invocation and
// TLS cert generation. Docker-only by design (see the plan note in
// setup-wizard.js) — no local-systemd-service path, no existing-host-nginx
// auto-wiring, no minimal-footprint relocation. Extracted out of
// setup-wizard.js so update.js can reuse the same bringUpDocker.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');
const { lanAddresses } = require('./network');

// Fixed, not user-configurable (see config/config.js) — whichever nginx
// fronts this app always proxies to this port; NGINX_HTTPS_PORT is what a
// user actually picks a port for.
const APP_PORT = 5570;

// Last 4.4.x release before MongoDB added the ARMv8.2-A CPU requirement —
// fallback for hardware that can't run anything newer (e.g. Raspberry Pi 4
// and earlier).
const LEGACY_ARM_MONGO_IMAGE = 'mongo:4.4.18';

function commandExists(cmd) {
    const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    return !result.error;
}

// Informational only — unlike fondwaypoints, this project doesn't auto-wire
// a host nginx site (see the plan note at the top of this file), so there's
// nothing to configure here. This just warns the setup form when a host
// nginx is already running, since the bundled Docker nginx container will
// try to bind NGINX_HTTP_PORT/NGINX_HTTPS_PORT (80/443 by default) on the
// same host and will fail to start if something else already holds them.
function detectHostNginx() {
    const installed = commandExists('nginx');
    let running = false;
    if (installed) {
        const status = spawnSync('systemctl', ['is-active', 'nginx'], { encoding: 'utf8' });
        running = status.status === 0 && status.stdout.trim() === 'active';
    }
    return { installed, running };
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

    console.log('\nDocker not found. Attempting to install via get.docker.com...');
    if (spawnSync('curl', ['--version'], { stdio: 'ignore' }).error) {
        console.log('curl not found — installing it first...');
        if (commandExists('apt-get')) { run('sudo', ['apt-get', 'update']); run('sudo', ['apt-get', 'install', '-y', 'curl']); }
        else if (commandExists('dnf')) run('sudo', ['dnf', 'install', '-y', 'curl']);
        else if (commandExists('yum')) run('sudo', ['yum', 'install', '-y', 'curl']);
    }
    const ok = spawnSync('sh', ['-c', 'curl -fsSL https://get.docker.com | sudo sh'], { stdio: 'inherit' }).status === 0;
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
function bringUpDocker(rootDir, mongoMode) {
    const composeFiles = ['-f', 'docker-compose.yml', '-f', 'docker-compose.nginx.yml'];
    if (mongoMode === 'internal') composeFiles.push('-f', 'docker-compose.mongo.yml');
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

module.exports = {
    APP_PORT,
    LEGACY_ARM_MONGO_IMAGE,
    mongoNeedsLegacyArmImage,
    commandExists,
    detectHostNginx,
    run,
    generateCert,
    ensureDockerInstalled,
    bringUpDocker
};
