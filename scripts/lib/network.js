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

function printAccessUrls(webFqdn, port) {
    const urls = new Set();
    urls.add(`https://${webFqdn}:${port}/`);
    for (const addr of lanAddresses()) urls.add(`https://${addr}:${port}/`);

    console.log('\nBalanced Waypoints should now be reachable at:');
    for (const url of urls) console.log(`  ${highlight(url)}`);
}

module.exports = { lanAddresses, printAccessUrls, highlight };
