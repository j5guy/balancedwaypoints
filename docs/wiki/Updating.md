# Updating

```bash
docker compose up -d
```

The published-image compose files (`docker-compose.pull.yml`, `dist-example/docker-compose.yml`)
set `pull_policy: always`, so this always fetches the latest image before recreating the container.
Run it any time a new release comes out — see the
[releases page](https://github.com/j5guy/balancedwaypoints/releases) to check what's new, or compare
your running `package.json` version against the latest tag.

Building from source instead of pulling:

```bash
git pull
docker compose up -d --build
```

## Automatic updates

There's no built-in scheduled auto-update. If you want `docker compose up -d` to run unattended on
a schedule, wire up your own cron entry, e.g.:

```bash
(crontab -l 2>/dev/null; echo "0 3 * * 0 cd /path/to/balancedwaypoints && docker compose up -d >> update.log 2>&1") | crontab -
```

## Uninstalling

```bash
docker compose down -v
```

**Destructive** — `-v` also removes the named volumes: MongoDB data (every account's budget data),
uploads, logs, backups, and the auto-generated session secret. Omit `-v` to stop the app while
keeping everything on disk for a later `docker compose up -d`.
