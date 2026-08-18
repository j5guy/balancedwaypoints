const os = require('os');

const COLOR_ENABLED = !!process.stdout.isTTY && !process.env.NO_COLOR;
function highlight(text) {
    return COLOR_ENABLED ? `\x1b[1;36m${text}\x1b[0m` : text;
}

// Skips loopback/internal interfaces, Docker's default bridge range, and any
// other virtual bridge, matched by interface name rather than IP range.
const VIRTUAL_IFACE_PREFIXES = /^(docker|br-|veth|virbr|tun|tap)/i;
function lanAddresses() {
    const addrs = [];
    for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
        if (VIRTUAL_IFACE_PREFIXES.test(name)) continue;
        for (const iface of ifaces) {
            if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('172.')) {
                addrs.push(iface.address);
            }
        }
    }
    return addrs;
}

// No port suffix any more — every app shares the Traefik proxy's single
// :443, routed by the Host() header, so only the domain itself resolves to
// this app. A bare LAN IP no longer reaches a specific app the way a
// per-app IP:port used to; reach it by its WEB_FQDN (via DNS or a hosts
// file entry pointing that name at this host) instead.
function printAccessUrls(webFqdn) {
    console.log('\nBalanced Waypoints should now be reachable at:');
    console.log(`  ${highlight(`https://${webFqdn}/`)}`);
}

module.exports = { lanAddresses, printAccessUrls, highlight };
