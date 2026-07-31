// Computed once at startup and reused for the lifetime of the process — the
// data can't change without a restart, so there's no reason to shell out to
// git on every request. package.json is the single source of truth for the
// version — there is no separate VERSION file to keep in sync.
const { execSync } = require('child_process');
const path = require('path');
const { version } = require('../package.json');

function git(args) {
    try {
        return execSync(`git ${args}`, { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim() || null;
    } catch (err) {
        return null;
    }
}

module.exports = {
    version,
    commit: git('rev-parse --short=10 HEAD'),
    commitDate: git("log -1 --format=%cd --date=format:'%Y-%m-%d %H:%M'"),
    env: process.env.NODE_ENV || 'development',
    startedAt: new Date()
};
