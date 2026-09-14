# Balanced Waypoints Wiki

This wiki covers everything beyond the basics in the
[README](https://github.com/j5guy/balancedwaypoints#readme): the full guided-setup walkthrough,
manual configuration, CI/CD internals, backup & restore, and administration.

- [Installation Guide](Installation-Guide.md) — the one-file Docker Compose install, every
  configuration variable, optional self-service TLS, local development without Docker, and
  first-account/signup behavior.
- [Updating](Updating.md) — how to pull the latest release and restart the stack, and how to tell
  whether an update is even needed.
- [CI/CD and Releases](CI-CD-and-Releases.md) — what happens on push to `test` vs. `master`, the
  GitHub mirror push, and the GitHub + Gitea release cut from `package.json`'s version.
- [Backup and Restore](Backup-and-Restore.md) — admin-scheduled whole-site backups, the separate
  per-user My Account backups, manual "run now", downloading/deleting backup files, and restoring
  from an upload or an existing file.
- [Admin Area](Admin-Area.md) — managing users, configuring LDAP (and how it interacts with local
  accounts), and the site-wide backup system.

For what the app does and the quick-start install paths, see the
[README](https://github.com/j5guy/balancedwaypoints#readme).
