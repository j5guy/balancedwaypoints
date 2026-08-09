# Updating

Whichever way this was installed — guided or manual, minimal footprint or full checkout, internal
or external MongoDB — updating later is the same one command, run from the install directory:

```bash
cd /opt/balancedwaypoints   # or wherever you installed to
./update.sh
```

`update.sh` is always there next to `.env` — either part of the repo (full checkout) or copied into
the trimmed-down install directory by the wizard itself (minimal footprint — see
[Installation Guide](Installation-Guide.md#installation-footprint)).

## What it does

First reads `.deploy-state.json` (written by the setup wizard, or by a previous `update.sh` run) to
find out which footprint this install actually is — an install from before this file existed is
treated as "full checkout", since that's the only footprint that existed then.

**Minimal footprint** — the same idea as a fresh install, just against a freshly-cloned copy of the
latest code instead of a form submission:
1. Clones the latest release into a scratch temp directory (`git clone --depth 1`), installs its
   npm dependencies.
2. Rebuilds the image from that scratch clone, regenerates `docker-compose.yml` (always
   regenerated from scratch, so it picks up any upstream compose changes — hand edits to it don't
   survive an update), copies the refreshed `nginx/nginx.conf.template` and `update.sh` into the
   install directory.
3. Brings the stack up from the install directory, then deletes the scratch clone.

**Full checkout**:
1. **Refuses to continue if `git status --porcelain` shows local changes** — commit or stash them
   first, so an update can't silently overwrite something you edited by hand.
2. Unshallows the repo first if it was a shallow (`--depth 1`) clone, so release tags are actually
   reachable, then `git fetch --tags origin`.
3. Checks out the newest `v*` tag, sorted by version (`git tag -l 'v*' --sort=-v:refname`). If no
   release tags exist yet, falls back to pulling the latest on the current branch instead. If it
   isn't a git checkout at all (e.g. you deployed from a tarball), it says so and leaves pulling
   changes up to you.
4. `npm install`, then rebuilds and restarts the Docker stack in place: `docker compose -f
   docker-compose.yml -f docker-compose.nginx.yml [-f docker-compose.mongo.yml] up -d --build`. The
   Mongo overlay is included automatically whenever `.env` still has `mongoHost=mongo` (i.e. you're
   using the bundled internal container) — external MongoDB deployments skip it, same as at install
   time.

Either way, `.env` and `certs/` in the install directory are left alone — only the application code
and the running containers are refreshed, and `.deploy-state.json` is rewritten with the new
version afterward.

## Checking whether you're up to date

There's no automatic in-app update checker in this project (unlike `fondwaypoints`, which polls
GitHub's releases API and shows a footer banner) — check the
[releases page](https://github.com/j5guy/balancedwaypoints/releases) on GitHub, or compare your
running `package.json` version against the latest tag, to decide whether it's worth running
`./update.sh`.

## Automatic updates

There's no built-in scheduled auto-update (no wizard checkbox, no cron entry installed for you).
If you want `./update.sh` to run unattended on a schedule, wire up your own cron entry, e.g.:

```bash
(crontab -l 2>/dev/null; echo "0 3 * * 0 cd /opt/balancedwaypoints && ./update.sh >> logs/update.log 2>&1") | crontab -
```

`update.sh` runs entirely non-interactively already (it aborts rather than prompting when there are
local changes to resolve), so no `--auto` flag is needed — it's safe to run from cron as-is.

## Uninstalling

`uninstall.sh` is the reverse of `install.sh` — curlable the same way, and destructive. See
[Uninstalling](https://github.com/j5guy/balancedwaypoints#uninstalling) in the README for the full
command and what it removes.
