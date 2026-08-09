# Balanced Waypoints Wiki

This wiki covers everything beyond the basics in the
[README](https://github.com/j5guy/balancedwaypoints#readme): the full guided-setup walkthrough,
manual configuration, CI/CD internals, backup & restore, and administration.

- [Installation Guide](Installation-Guide.md) — full guided-setup walkthrough (what the wizard form
  asks and in what order), manual `.env` setup without the wizard, local development without
  Docker, MongoDB internal-vs-external, TLS certificate options, and first-account/signup behavior.
- [What the Setup Script Does](What-the-Setup-Script-Does.md) — a transparency reference: exactly
  what `install.sh` and `scripts/setup-wizard.js` install, write to disk, and send over the
  network, and where `sudo` is used, step by step.
- [Updating](Updating.md) — what `./update.sh` actually does to an existing install (checking out
  the newest release tag, rebuilding, restarting the Docker stack), and how to tell whether an
  update is even needed.
- [CI/CD and Releases](CI-CD-and-Releases.md) — what happens on push to `test` vs. `master`, the
  GitHub mirror push, and the GitHub + Gitea release cut from `package.json`'s version.
- [Backup and Restore](Backup-and-Restore.md) — admin-scheduled whole-site backups, the separate
  per-user My Account backups, manual "run now", downloading/deleting backup files, and restoring
  from an upload or an existing file.
- [Admin Area](Admin-Area.md) — managing users, configuring LDAP (and how it interacts with local
  accounts), and the site-wide backup system.

For what the app does and the quick-start install paths, see the
[README](https://github.com/j5guy/balancedwaypoints#readme).
