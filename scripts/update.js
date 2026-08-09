#!/usr/bin/env node
// Node half of update.sh — the bash wrapper handles getting the right code
// on disk (git fetch/checkout for a full checkout, or a fresh scratch clone
// for a minimal footprint) and installing Node.js/npm deps if missing; this
// script does the same "bring the app up" work scripts/setup-wizard.js
// does, reading what to do from .deploy-state.json/.env instead of a
// submitted form, so an update ends up running the exact same code path a
// fresh install would.
const fs = require('fs');
const path = require('path');
const bringUp = require('./lib/bringUp');
const { trimToMinimalFootprint } = require('./lib/footprint');

function parseArgs(argv) {
    const args = { mode: 'full', finalDir: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--mode' && argv[i + 1]) args.mode = argv[++i];
        else if (argv[i] === '--final-dir' && argv[i + 1]) args.finalDir = argv[++i];
    }
    return args;
}

function readEnv(dir) {
    try {
        return Object.fromEntries(
            fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n')
                .map(l => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
                .filter(Boolean).map(m => [m[1], m[2]])
        );
    } catch {
        return {};
    }
}

function readInstalledVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
    } catch {
        return 'unknown';
    }
}

// Installs from before .deploy-state.json existed (or a minimal-footprint
// host's very first update.js run — .env there has no mongoHost=mongo
// grep-able the old bash way, but does have whatever the wizard wrote)
// don't have a recorded mongoMode — fall back to inferring it the same way
// the pre-footprint update.sh did, from .env's mongoHost value.
function resolveMongoMode(state, env) {
    if (state.mongoMode) return state.mongoMode;
    return env.mongoHost === 'mongo' ? 'internal' : 'external';
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const installedVersion = readInstalledVersion();

    if (args.mode === 'minimal') {
        if (!args.finalDir) {
            console.error('--final-dir is required with --mode minimal.');
            process.exit(1);
        }
        const finalDir = path.resolve(args.finalDir);
        const state = bringUp.readDeployState(finalDir) || {};
        const env = readEnv(finalDir);
        // This script's own checkout (__dirname/..) is the fresh scratch
        // clone update.sh just made — trimToMinimalFootprint uses it as the
        // Docker build context and the source of nginx.conf.template/
        // update.sh, then deletes it once the rebuilt stack is up, exactly
        // like a fresh minimal install.
        trimToMinimalFootprint(path.join(__dirname, '..'), finalDir, {
            mongoMode: resolveMongoMode(state, env),
            nginxHttpsPort: env.NGINX_HTTPS_PORT || '5570',
            nginxHttpPort: env.NGINX_HTTP_PORT || '80',
            installedVersion
        });
        return;
    }

    // Full checkout — update.sh has already git-checked-out the newest tag
    // and run `npm install` in the current directory before invoking this,
    // so rootDir is simply cwd.
    const rootDir = process.cwd();
    const state = bringUp.readDeployState(rootDir) || {};
    const env = readEnv(rootDir);
    const mongoMode = resolveMongoMode(state, env);

    bringUp.writeDeployState(rootDir, { footprint: 'full', mongoMode, installedVersion });
    bringUp.bringUpDocker(rootDir, mongoMode);
}

main();
