# Updating

Whichever way this was installed — guided or manual, internal or external MongoDB — updating a
Docker deployment later is the same one command, run from the install directory:

```bash
cd /opt/balancedwaypoints   # or wherever you installed to
./update.sh
```

`update.sh` is always there next to `.env` in a checkout — it's part of the repo, not something the
installer generates separately.

## What it does

1. **Refuses to run outside an install directory** — if there's no `.env` next to it, it aborts
   immediately rather than guessing.
2. **If this is a git checkout** (`.git/` present):
   - **Refuses to continue if `git status --porcelain` shows local changes** — commit or stash them
     first, so an update can't silently overwrite something you edited by hand.
   - Unshallows the repo first if it was a shallow (`--depth 1`) clone, so release tags are
     actually reachable, then `git fetch --tags origin`.
   - Checks out the newest `v*` tag, sorted by version (`git tag -l 'v*' --sort=-v:refname`). If no
     release tags exist yet, falls back to `git pull` on whatever branch is currently checked out.
   - If it isn't a git checkout at all (e.g. you deployed from a tarball), it says so and leaves
     pulling changes up to you.
3. **Rebuilds and restarts the Docker stack**: `docker compose -f docker-compose.yml
   -f docker-compose.nginx.yml [-f docker-compose.mongo.yml] up -d --build`. The Mongo overlay is
   included automatically whenever `.env` still has `mongoHost=mongo` (i.e. you're using the
   bundled internal container) — external MongoDB deployments skip it, same as at install time.

`.env`, `certs/`, and anything else you've customized in the install directory are left alone —
only the application code and the running containers are refreshed. There's no separate "minimal
footprint" vs. "full checkout" distinction to worry about here (unlike some sibling projects) —
this project's installer always keeps the full checkout on disk, since Docker-only deployment needs
it there to build from anyway.

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
