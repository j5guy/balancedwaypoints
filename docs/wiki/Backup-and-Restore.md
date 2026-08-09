# Backup and Restore

> This page describes the real, in-app backup system (`services/backup/backupService.js`,
> `services/backup/backupScheduler.js`, `controllers/adminController.js`,
> `controllers/accountController.js`). An earlier version of this page claimed there was no in-app
> backup feature in this version — that was wrong; it's been fully rewritten below.

A backup is a full dump of MongoDB data (site-wide) or of just one user's own owner-scoped
documents (personal), EJSON-encoded and gzipped into a single `.json.gz` file — entirely in Node,
with no `mongodump`/`mongorestore` binary required. That matters because this app's Docker image
deliberately stays minimal, and some deployments run on ARM hardware where installing MongoDB's own
tooling package is its own headache. There are two independent scopes, sharing all of the same
underlying code:

- **Site-wide** (Admin &gt; Backups) — every collection registered with Mongoose except operational
  logs (`BackupRun` itself is excluded, so a restore can't erase the log of itself). Only admins can
  reach this.
- **Personal** (My Account &gt; Backups) — just the collections that carry an `owner` field
  (accounts, transactions, categories, payees, rules, schedules, etc.), filtered to the logged-in
  user's own documents. Available to every user, admin or not, for their own data only.

Filenames are namespaced by scope — `balancedwaypoints-backup-site-<timestamp>.json.gz` for
site-wide, `balancedwaypoints-backup-user-<userId>-<timestamp>.json.gz` for personal — so both
kinds can share the same destination directory without listing, retention, or restore for one
scope ever touching the other's files.

## Admin &gt; Backups (site-wide)

`/admin/backups`. Configure, from the UI, without editing `.env` or redeploying:

- **Destination** — a directory path. Defaults to `backups/` inside the app container (baked into
  the image, backed by the `backups-data` Docker volume in `docker-compose.yml`, so it survives the
  container being recreated). To point it at a NAS/network location instead, bind-mount that host
  path into the container (see `BACKUP_HOST_DIR` in `.env.example`, same pattern as
  `SSL_CERT_FILE`/`SSL_KEY_FILE`) and set the destination to the container-side path.
- **Frequency** — disabled, daily, or weekly.
- **Time** — HH:MM, 24-hour, server-local time.
- **Day of week** — only used when frequency is weekly.
- **Retention count** — how many backup files (for this scope) to keep; older ones are deleted
  automatically the moment a new one is written successfully.

Saving takes effect immediately — the scheduled cron task is torn down and rebuilt right then
(`backupScheduler.reloadSite()`), no redeploy or restart needed.

> **Check the destination before you trust it.** The **Check destination** button doesn't just
> check that the path exists — it stats it, confirms it's actually a directory, and writes (then
> deletes) a small probe file to confirm it's writable. This is what catches a disconnected network
> mount, a read-only filesystem, or a typo'd path *before* a 3 a.m. scheduled run silently fails.

- **Run backup now** triggers one immediately, independent of the schedule — useful for confirming
  your configuration actually works.
- The **backup runs** list shows the history of every backup/restore attempt for this scope: when
  it ran, whether it was manual or scheduled, success/error, file size, and (for a manual run) who
  triggered it. Nothing here is ever deleted automatically — it's a separate collection
  (`BackupRun`) excluded from the backups themselves.
- The **backup files** list shows every backup file currently in the destination directory, each
  with **Download** and **Delete** actions.

### Restoring a site-wide backup

From `/admin/backups`, either:

- **Upload a file** — pick a `.json.gz` backup file from your computer and submit it.
- **Restore an existing file** — pick one already listed on the page.

Either way, restoring:

1. Verifies the file is a recognizable Balanced Waypoints backup (has the expected `meta`/
   `collections` shape) and that its declared scope actually matches (`site`, not `user`) — a
   personal backup file can't accidentally be restored as a site-wide one, or vice versa.
2. For every collection present in the backup that still corresponds to a currently-registered
   model, **wipes that collection entirely and re-inserts** the backed-up documents (in batches of
   500, to stay under MongoDB's 16MB-per-command limit on a large register). Inserts go straight
   through the MongoDB driver, not Mongoose model validation — so a document that predates a schema
   change since the backup was taken still restores byte-for-byte instead of failing validation.
3. Records the attempt (success or the specific error) in the backup-runs history either way.

> **Restoring is destructive and immediate — there's no dry run.** Every collection present in the
> backup file is fully replaced, not merged. The confirmation step lives in the browser UI, the same
> convention as every other dangerous action in this app (e.g. deleting a user) — there's no
> server-side "are you sure" beyond that.

## My Account &gt; Backups (personal data only)

`/account/backups` — the exact same feature set as Admin &gt; Backups above (destination, frequency,
time, day of week, retention count, run now, list/download/delete files, restore from upload or
from an existing file), but scoped to **just the logged-in user's own data** instead of the whole
database. This is available to every user, not only admins — it lives on `controllers/
accountController.js`, which mirrors the admin controller's backup functions against
`{ scope: 'user', userId: req.session.userId }` instead of `{ scope: 'site' }`.

The key difference beyond scope: a personal backup only ever dumps or restores collections that
have an `owner` field (accounts, transactions, categories, category groups, payees, rules,
schedules, tags, account shares), and every dump/restore is additionally filtered to `owner ==
this user`. Restoring a personal backup wipes and replaces only *this user's own* documents within
each affected collection — everyone else's rows in those same shared collections are left alone. A
personal backup file also can't be restored as a site-wide one (or another user's personal backup)
— the scope and, for personal files, the user ID are checked against the file's own metadata before
anything is written.

Each user's personal backup schedule is independent of everyone else's and of the site-wide one —
deleting a user's account (from Admin &gt; Users) stops their own scheduled backups but deliberately
leaves any backup files they'd already produced on disk, in case an admin still wants them.

## Restoring onto a brand-new deployment

There's no separate CLI restore script — the same in-app restore flow above works on a fresh
install too, since restoring never assumes anything about what MongoDB already contains beyond
which collections are currently registered:

1. Bring up a fresh Balanced Waypoints deployment (see [Installation Guide](Installation-Guide.md)),
   pointed at whichever MongoDB you want going forward — internal or external, doesn't need to
   match the old deployment's choice.
2. Sign up for the first account (this becomes admin automatically), or use
   `node scripts/createUser.js <email> --password <password> --admin` to bootstrap one directly.
3. From Admin &gt; Backups, restore the site-wide backup file from the old deployment (upload it).

Because a site-wide restore includes the `User` collection itself, every account's password hash,
admin flag, LDAP association, and preferences come back exactly as they were — you don't need to
re-create individual accounts by hand first, and the account you just signed up with to reach the
restore screen will simply be overwritten/replaced by whatever was in the backup once it runs.
