# Admin Area

Available at `/admin` to any user with `isAdmin` set — anyone else hitting `/admin` gets a 403
(`middleware/auth.js`'s `requireAdmin`/`requireApiAdmin`). **The first person to ever sign up
automatically becomes admin**, regardless of `ADMIN_EMAIL` — see
[Installation Guide](Installation-Guide.md#first-account). To grant it to a specific *later* signup
instead, set `ADMIN_EMAIL` in `.env` before that account is created. There's no other promote-a-
user flow outside the Users page below, and no CLI flag for it beyond `scripts/createUser.js
<email> --password <password> --admin` (bootstraps a brand-new account as admin directly, without
going through signup).

## Users

`/admin/users` lists every account on the deployment. For each one, an admin can:

- **Edit** the account's email and display name (`PUT /api/admin/users/:id`).
- **Toggle admin access** (`PUT /api/admin/users/:id/admin`) — blocked against removing your *own*
  admin access, so you can't accidentally lock yourself out.
- **Delete the account** (`DELETE /api/admin/users/:id`) — also blocked against deleting your own
  account. Deleting a user stops their scheduled personal backups (if any were configured) but
  deliberately leaves their existing backup files on disk untouched — an admin might still want
  them.

Password, `authSource` (local vs. LDAP), and `ldapUsername` are not editable from here — those stay
outside admin's reach; LDAP accounts self-heal their email/display name from the directory on every
login instead (see `controllers/authController.js`'s `loginLdap`).

Each user's tags, categories, category groups, payees, transactions, accounts, rules, and schedules
are their own private data (every model carries an `owner` field — see
[README: What makes this different](https://github.com/j5guy/balancedwaypoints#what-makes-this-different-from-a-normal-self-hosted-app))
— there's no cross-user moderation step for any of it, and admin status doesn't grant visibility
into another user's budget. The one exception is deliberate, opt-in **account sharing**
(`models/accountShare.js`): any user can grant another user `readonly` or `readwrite` access to one
specific account of theirs, entirely outside the admin area.

## LDAP

`/admin/ldap` — lets an admin configure (or reconfigure) LDAP login from the UI, without touching
`.env` or redeploying. This never replaces local (email/password) login; both authentication paths
are always available together once LDAP is enabled.

- **Host / bind DN / bind password / search base / search filter** — the same fields `.env`'s
  `LDAP_*` variables cover (see [Installation Guide](Installation-Guide.md#configuration) for what
  each means). The search filter must contain the literal `{{username}}` placeholder.
- **Save** (`PUT /api/admin/settings/ldap`) stores the settings in the `Settings` singleton
  document in MongoDB, and **takes priority over `.env`** from then on
  (`config/ldapAuth.js`'s `resolveLdapConfig` checks the database first, falling back to `.env`
  only if nothing has ever been saved). The bind password is AES-256-GCM encrypted at rest
  (`utils/secretCrypto.js`, keyed off `sessionSecret` via HMAC-SHA256) and is never sent back to
  the browser — a bind password is required the very first time LDAP is enabled, but can be left
  blank on a later save to keep the one already stored.
- **Test connection** (`POST /api/admin/settings/ldap/test`) verifies just the service-account
  bind — host reachable, `bindDN`/`bindPassword` valid — against either the not-yet-saved values in
  the form or whatever's currently active if submitted empty. It does not test a specific user's
  login, only that the directory itself is reachable with these service credentials.
- **Reset to `.env`** (`DELETE /api/admin/settings/ldap`) clears the database override, falling
  back to whatever's in `.env` (or LDAP being unconfigured entirely if that's blank too).

Under the hood, a login attempt against LDAP binds as the service account
(`bindDN`/`bindPassword`), searches `searchBase` with `searchFilter` for the entered username, then
attempts a second bind as the matched entry's own DN with the password the user typed
(`config/ldapAuth.js`'s `authenticateLdap`) — the service account's credentials are never used to
verify the user's own password. A successful LDAP login auto-provisions a local `User` document on
first login (`authSource: 'ldap'`), which then behaves like any other account (own accounts,
budget, backups, etc.) going forward.

## Backups

`/admin/backups` — the whole-site, deployment-level backup system. Every account's accounts,
transactions, categories, payees, rules, and schedules — every collection with an `owner` field,
plus everything else registered with Mongoose except operational logs — dumped straight from
MongoDB (EJSON-encoded and gzipped, entirely in Node — no `mongodump` binary required). This is
distinct in scope from **My Account &gt; Backups**, described below, which only ever touches the
data belonging to whoever's logged in.

- **Settings** (`GET`/`PUT /api/admin/settings/backup`) — a **destination** directory (defaults to
  `backups/` inside the app container, backed by the `backups-data` Docker volume — see
  `BACKUP_HOST_DIR` in `.env.example` to point it at a host/NAS directory instead), a **frequency**
  (disabled / daily / weekly), a **time of day** (HH:MM, server-local), a **day of week** (weekly
  only), and a **retention count** (how many backup files to keep before the oldest are deleted
  automatically). Saving reloads the scheduled job immediately (`backupScheduler.reloadSite()`) —
  no redeploy needed.
- **Check destination** (`POST /api/admin/settings/backup/check`) — an explicit existence +
  directory + actual write-probe check (writes and deletes a small temp file) against either the
  not-yet-saved destination in the form or whatever's currently configured. This is what catches a
  disconnected network mount, a read-only filesystem, or a typo'd path before a scheduled run ever
  depends on it.
- **Run backup now** (`POST /api/admin/backup/run`) — triggers a backup immediately, independent of
  the schedule.
- **Backup runs** (`GET /api/admin/backup/runs`) — history of every backup/restore attempt for this
  scope (`models/backupRun.js`): action, trigger (manual/scheduled), status, timestamps, size,
  error message if it failed, and who triggered a manual one.
- **Backup files** (`GET /api/admin/backup/files`) — every file currently in the destination
  directory matching the site-wide naming pattern, each with **Download**
  (`GET /api/admin/backup/files/:name/download`) and **Delete**
  (`DELETE /api/admin/backup/files/:name`) actions.
- **Restore** — either from an uploaded file (`POST /api/admin/backup/restore-upload`, multipart) or
  from one of the files already listed above (`POST /api/admin/backup/files/:name/restore`).
  Restoring wipes and replaces every collection present in the backup — see
  [Backup and Restore](Backup-and-Restore.md) for the full mechanics and safety checks.

### My Account &gt; Backups — the personal-scope equivalent

`/account/backups` — the exact same feature set (settings, run now, list/download/delete files,
restore from upload or from an existing file), scoped to **just the logged-in user's own data**
instead of the whole site. It's available to every user, not just admins — `controllers/
accountController.js` mirrors `adminController.js`'s backup functions against
`{ scope: 'user', userId }` instead of `{ scope: 'site' }`. A personal backup can live in the same
destination directory as the site-wide one without conflict — filenames are namespaced by scope
(and by user ID for personal ones), so listing, retention, and restore for one scope never touches
the other's files. See [Backup and Restore](Backup-and-Restore.md#my-account--backups-personal-data-only)
for details.
