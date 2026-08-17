// Shared "actually bring the app up" logic — Docker compose invocation and
// TLS cert generation. Docker-only by design (see the plan note in
// setup-wizard.js) — no local-systemd-service path. It DOES optionally wire
// up an existing host nginx (see detectHostNginx/installHostNginxSite
// below) — unlike fondwaypoints, this doesn't replace the bundled Docker
// nginx sidecar (that one's ports aren't user-configurable per-request the
// way fondwaypoints' local-mode app port is); instead the host nginx
// becomes the public-facing TLS terminator and reverse-proxies to the
// bundled nginx sidecar over loopback HTTPS, which keeps terminating TLS
// internally too. Extracted out of setup-wizard.js so scripts/update.js and
// scripts/lib/footprint.js can reuse the same bringUpDocker/deploy-state
// helpers.
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

const SITE_FILE_NAME = 'balancedwaypoints.conf';

// Detects the sites-available/sites-enabled (Debian/Ubuntu) vs conf.d (RHEL/
// Rocky) layout, so installHostNginxSite writes the generated site config
// wherever this host's nginx actually reads config from.
function nginxSiteDir() {
    if (fs.existsSync('/etc/nginx/sites-available') && fs.existsSync('/etc/nginx/sites-enabled')) {
        return { style: 'debian', available: '/etc/nginx/sites-available', enabled: '/etc/nginx/sites-enabled' };
    }
    if (fs.existsSync('/etc/nginx/conf.d')) {
        return { style: 'rhel', available: '/etc/nginx/conf.d', enabled: null };
    }
    return null;
}

// installed/running gate whether the setup form even offers to write a host
// nginx site; siteExists (only meaningful when a layout was detected) gates
// whether it's OFFERED at all — an existing balancedwaypoints.conf is left
// alone rather than silently overwritten, since it may have been hand-edited.
function detectHostNginx() {
    const installed = commandExists('nginx');
    let running = false;
    if (installed) {
        const status = spawnSync('systemctl', ['is-active', 'nginx'], { encoding: 'utf8' });
        running = status.status === 0 && status.stdout.trim() === 'active';
    }
    const siteDir = installed ? nginxSiteDir() : null;
    const siteExists = !!siteDir && fs.existsSync(path.join(siteDir.available, SITE_FILE_NAME));
    return { installed, running, canWriteSite: !!siteDir, siteExists };
}

// Writes (and enables) a host nginx site for webFqdn — this becomes the
// public-facing TLS terminator (using the same cert/key balancedwaypoints
// itself is already configured with), reverse-proxying over loopback HTTPS
// to the bundled Docker nginx sidecar's own HTTPS listener (which keeps
// terminating TLS internally too — see the plan note at the top of this
// file for why this double-hop is the simplest option here). Requires sudo
// to write under /etc/nginx and reload the service.
//
// Reachable two ways, same as fondwaypoints' own host-nginx site: by domain
// (webFqdn, on the standard 80/443 — 80 redirects to 443) and directly by
// this host's LAN IP address(es) on ipPort, for whenever DNS for webFqdn
// isn't set up yet or reaching it by IP is just more convenient.
function installHostNginxSite(webFqdn, ipPort, dockerHttpsPort, certPath, keyPath) {
    console.log('\n== Adding a host nginx site ==');
    const siteDir = nginxSiteDir();
    if (!siteDir) {
        console.error('Could not detect an nginx sites-available/sites-enabled or conf.d layout under /etc/nginx — skipping the host nginx site. Add one by hand if needed.');
        return false;
    }

    const proxyBlock = `  location / {
    proxy_pass https://127.0.0.1:${dockerHttpsPort};
    proxy_ssl_verify off;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Port $server_port;

    proxy_read_timeout 90s;
    proxy_connect_timeout 90s;
    proxy_send_timeout 90s;
  }`;

    const lanAddrs = lanAddresses();
    const confContent = `server {
  listen 80;
  server_name ${webFqdn};
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  server_name ${webFqdn};

  ssl_certificate ${certPath};
  ssl_certificate_key ${keyPath};
  ssl_protocols TLSv1.2 TLSv1.3;

  access_log /var/log/nginx/balancedwaypoints-access.log;
  error_log /var/log/nginx/balancedwaypoints-error.log;

${proxyBlock}
}

server {
  listen ${ipPort} ssl;
  server_name ${lanAddrs.length ? lanAddrs.join(' ') : '_'};

  ssl_certificate ${certPath};
  ssl_certificate_key ${keyPath};
  ssl_protocols TLSv1.2 TLSv1.3;

  access_log /var/log/nginx/balancedwaypoints-access.log;
  error_log /var/log/nginx/balancedwaypoints-error.log;

${proxyBlock}
}
`;

    const targetPath = path.join(siteDir.available, SITE_FILE_NAME);
    const linkPath = siteDir.style === 'debian' ? path.join(siteDir.enabled, SITE_FILE_NAME) : null;

    console.log(`Writing ${targetPath} (requires sudo)...`);
    const tee = spawnSync('sudo', ['tee', targetPath], { input: confContent, stdio: ['pipe', 'ignore', 'inherit'] });
    if (tee.status !== 0) {
        console.error('Failed to write the nginx site config. Do you have sudo access?');
        return false;
    }

    if (linkPath && !run('sudo', ['ln', '-sf', targetPath, linkPath])) {
        console.error('Failed to symlink the site into sites-enabled.');
        return false;
    }

    if (!run('sudo', ['nginx', '-t'])) {
        console.error(`nginx config test failed — the site was written to ${targetPath} but NOT enabled/reloaded. Fix the error above, then run: sudo nginx -t && sudo systemctl reload nginx`);
        return false;
    }
    if (!run('sudo', ['systemctl', 'reload', 'nginx'])) {
        console.error('Failed to reload nginx — the site config is in place but not yet active. Run: sudo systemctl reload nginx');
        return false;
    }
    const accessUrls = [`https://${webFqdn}/`, ...lanAddrs.map(addr => `https://${addr}:${ipPort}/`)];
    console.log(`Done — this app is now also reachable via the host's nginx at:\n${accessUrls.map(u => `  ${u}`).join('\n')}`);
    return true;
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
    detectHostNginx,
    nginxSiteDir,
    installHostNginxSite,
    findOpenPort,
    isPortFree,
    run,
    generateCert,
    ensureDockerInstalled,
    bringUpDocker,
    readDeployState,
    writeDeployState
};
