# Balanced Waypoints

> Balanced Waypoints is envelope budgeting for people who'd rather self-host their financial
> data than hand it to a subscription service. Every dollar you have gets assigned to a category
> before you spend it — the same discipline as the envelope-in-a-drawer method your grandparents
> used, just with a rolling balance, split transactions, and import rules doing the bookkeeping for
> you. It's Quicken/Actual-Budget-shaped, but it's your database, your backups, and your server.

📖 Full documentation lives on the
[wiki](https://github.com/j5guy/balancedwaypoints/wiki) — this README covers the basics and how to
install it. See [RELEASE_NOTES](RELEASE_NOTES) for release notes and version history.

## What makes this different from a normal self-hosted app

- **Every user's data is fully isolated by default.** Accounts, transactions, categories, payees,
  rules, and schedules all carry an `owner` field (see `models/*.js`) and every query is scoped to
  it — one deployment can host any number of separate people, each with their own private budget,
  with no shared "household" concept unless someone explicitly opts in.
- **Account sharing, not household merging.** Rather than pooling everyone's data together, you can
  grant another user `readonly` or `readwrite` access to one specific account of yours
  (`models/accountShare.js`) — useful for a partner who needs visibility into the joint checking
  account without seeing your entire budget. Access is per-account, not all-or-nothing.
- **Envelope budgeting, explained.** Every category gets a dollar amount assigned to it each month;
  spending draws down that category's own balance, unspent amounts roll forward, and a "Ready to
  Assign" figure tells you what's still unassigned across every account. It's a forecasting tool as
  much as a tracking one — you decide where money is going before it's gone.
- **LDAP is an optional layer on top of local accounts, never a replacement.** Point it at Active
  Directory or OpenLDAP and both authentication paths stay available side by side — nothing forces
  every user onto one or the other (`config/ldapAuth.js`).
- **Backups are a first-class, in-app feature, not an afterthought.** Whole-site scheduled backups
  live under Admin, and every individual user can independently schedule and restore backups of
  just their own data from My Account — see [Backup and Restore](https://github.com/j5guy/balancedwaypoints/wiki/Backup-and-Restore).
- **Docker-only, deliberately simple.** There's no local-systemd-service install path and no
  existing-host-nginx auto-wiring the way some sibling projects have — the guided setup always
  brings the app up as a small Docker Compose stack (app + bundled nginx, optionally bundled
  MongoDB), which keeps the installer and this README a lot shorter.

## Features

- **Accounts** — checking, savings, credit cards, cash, investments, loans, and a generic "other"
  type; on-budget accounts count toward envelope math, off-budget/tracking accounts (investments,
  loans) still show a balance but are excluded from it. Each account can set its own forecast
  low-balance warning threshold (a dollar amount and a color), shown on that account's own Forecast
  chart — credit/loan/other account types skip this warning by default since a negative balance
  there is normal, not a problem.
- **Transactions** — split a single transaction across multiple categories, record transfers
  between your own accounts, tag transactions, and track cleared/reconciled status per row. The
  register supports manual drag-and-drop ordering as an alternative to date-sorting, and can mask
  amount/balance columns behind a placeholder for screen-sharing.
- **Envelope budgeting** — assign a dollar amount to each category per month, with a rolling
  balance carried forward and a running "Ready to Assign" figure.
- **Categories and category groups** — organized into groups, with archiving for ones you no longer
  budget for but don't want to delete outright (their transaction history stays intact).
- **Clean Up Categories** (`/budget/categories/cleanup`) — a dedicated tool that finds duplicate
  categories (by name) and offers to merge them into one, and finds categories with no transactions
  and offers to bulk-delete them — both operations scrub every reference across the app (payee
  default categories, rule actions, dashboard widget category filters), not just the transactions
  table.
- **Payees** — each with an optional default category to speed up entry, plus free-form contact
  info (address, phone, your account number with them). A payee can also represent "Transfer to
  &lt;Account&gt;", so picking it on a transaction creates the paired transfer automatically.
- **Rules** — auto-categorize, rename payees, and tag transactions on import based on conditions
  (payee/notes/amount contains, equals, starts with, greater/less than), evaluated in priority
  order with an optional "stop processing further rules" flag per rule.
- **Schedules** — recurring transactions (bills, paychecks) that either auto-enter into the
  register on their due date or just remind you they're coming. Individual upcoming occurrences can
  be overridden (amount, category, payee, or skipped) without touching the base recurrence, and each
  schedule can optionally email you when it's about to come due.
- **Account sharing** — grant another user read-only or read-write access to one of your accounts,
  independent of full account/budget access.
- **Import** — CSV (tolerant bank-export column detection) and OFX/QFX, with duplicate detection
  against previously-imported rows and rule-based category/tag suggestions before you commit.
- **Bank Sync** (optional) — link a [SimpleFIN](https://www.simplefin.org/) bridge from My Account &gt;
  Bank Sync to auto-import new transactions every few hours (plus a manual "Sync now"), instead of
  uploading CSV/OFX by hand. Runs through the same dedupe and rule-based categorization as manual
  import; an account can be unlinked at any time without touching its history.
- **Reports** — spending by category, income vs. expense, and net worth over time.
- **Dashboard** — a customizable widget grid (drag-to-reorder, not free-resize): repeatable summary/
  income/expense/net-budget widgets that can each be scoped to a specific account or all of them,
  net-worth and cash-flow trend widgets, a forecast widget with its own configurable look-back/
  look-ahead window and low-balance threshold, and a spending-by-category donut chart with a
  category picker (choose exactly which categories get their own slice) and a Top 5 / Top 10 mode
  for the rest.
- **LDAP login** (optional) — log in against Active Directory/OpenLDAP alongside local accounts,
  configurable at install time via `.env` or later from Admin &gt; LDAP without a redeploy. The bind
  password is AES-256-GCM encrypted at rest, keyed off `sessionSecret`.
- **Email notifications** — each person configures their own outgoing mail server from My Account
  &gt; Mail Server (not a shared admin-configured relay); per-schedule "email when due" alerts and an
  opt-in weekly summary go out through it.
- **API access** — each user can generate a read-only API key (My Account &gt; API access) for
  hitting the reporting endpoints from an external tool (e.g. a Grafana Infinity datasource), without
  a browser session.
- **Appearance** — per-user, per-theme (light/dark independently) overrides for the app's core
  colors, from My Account &gt; Appearance.
- **Backups** — manual or scheduled (daily/weekly, at a time you pick), with a destination directory
  and retention count you choose, plus a check that the destination is actually reachable and
  writable before it's relied on. Admins back up the whole site from Admin &gt; Backups; anyone can
  also back up just their own data from My Account &gt; Backups. Restoring is supported from either
  page, from an uploaded file or an existing backup file already on disk.

## Installation

### Guided install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/j5guy/balancedwaypoints/master/install.sh | bash
```

Installs whatever this host is missing (git, curl, Node.js), clones the repo into
`/opt/balancedwaypoints` (override with `--dir /some/other/path`, or the
`BALANCEDWAYPOINTS_INSTALL_DIR` environment variable — created for you via `sudo mkdir` + `chown` to
your own user, so nothing afterward needs `sudo`), installs npm dependencies, and hands off to the
guided setup wizard (`scripts/setup-wizard.js`).

Already have a checkout, or want to review the script first? Same thing, run locally — this
operates in place, with no scratch clone or `--dir` involved:

```bash
git clone https://github.com/j5guy/balancedwaypoints.git
cd balancedwaypoints
./install.sh
```

The wizard starts a small local web server (bound to this machine, not the public internet) and
prints a URL to open in a browser:

```
Open this URL in a browser to continue setup:
  http://localhost:<random port>/
```

The form asks for:

- **MongoDB** — Internal (bundled `mongo` container, recommended) or External (point at your own
  server — fills in `mongoHost`/`mongoUser`/`mongoPass`).
- **TLS certificate** — Generate one (a local Certificate Authority the first time, then a
  certificate for your domain signed by it — no public CA or real domain needed) or provide your
  own `SSL_CERT_FILE`/`SSL_KEY_FILE`.
- **Domain name (or IP)**, HTTPS/HTTP ports for the bundled nginx, an always-admin email (optional),
  currency symbol, and the LDAP fields below (all optional — leave blank to skip LDAP entirely).

> **ARM / Raspberry Pi:** if you pick Internal MongoDB, the wizard reads `/proc/cpuinfo` for the
> `atomics` CPU feature and automatically falls back to `mongo:4.4.18` (the last release before
> MongoDB required ARMv8.2-A) on hardware that can't run current MongoDB versions — a plain notice
> appears next to the MongoDB choice when this applies. There's nothing to fill in for it.

Submitting the form writes `.env`, generates the TLS certificate if requested, and runs
`docker compose up -d --build` for you. The app is **Docker-only** — there is no local systemd
service mode.

> **Import the certificate before visiting the site.** Unless you supplied a certificate from a
> public CA (e.g. Let's Encrypt), your browser won't trust the one the wizard generated. It offers a
> download link for the CA certificate (`certs/ca.pem`, always on the host outside Docker too) —
> install that into the OS/browser trust store of every device that needs to reach the site without
> a warning.

The terminal prints the URL(s) the app is reachable at once it's up — your `WEB_FQDN` and this
machine's LAN IP address(es), on whichever port you picked. Visit `/auth/signup` on one of those to
create the first account.

## Manual install

```bash
git clone https://github.com/j5guy/balancedwaypoints.git
cd balancedwaypoints
cp .env.example .env   # fill in the values, or run the wizard instead: node scripts/setup-wizard.js
docker compose -f docker-compose.yml -f docker-compose.nginx.yml -f docker-compose.mongo.yml up -d --build
```

Omit `-f docker-compose.mongo.yml` if pointing `mongoHost` at an external MongoDB server instead of
the bundled container. See [`.env.example`](.env.example) for every variable and what it does.

## Local development (no Docker)

```bash
npm install
npm run build-css      # or npm run watch-css while developing
cp .env.example .env   # set mongoHost=localhost (or wherever a local Mongo runs) and sessionSecret
echo "NODE_ENV=development" >> .env
node server.js
```

The app listens on port 5570 directly (no nginx in front) in this mode, over plain HTTP.

> **`NODE_ENV=development` is required for local dev.** Without it, `config/config.js` defaults to
> `production`, which makes the session and CSRF cookies `Secure`-only (the CSRF cookie is even
> `__Host-`-prefixed, which browsers refuse to set at all over plain HTTP). Leaving `NODE_ENV` unset
> is only safe behind the bundled/Docker nginx, which actually terminates TLS.

The first person to sign up (`/auth/signup`) automatically becomes admin, regardless of
`ADMIN_EMAIL` — signup is always open, and every account gets its own separate, empty set of
accounts/categories/budget. `ADMIN_EMAIL` only matters for making a *later* signup an admin too.
There's also a CLI bootstrap for creating an account before the web signup flow is reachable, or for
recovering admin access:

```bash
node scripts/createUser.js <email> --password <password> [--admin]
```

## Updating

Same one command regardless of how it was installed, run from the install directory:

```bash
cd /opt/balancedwaypoints   # or wherever you installed to
./update.sh
```

Checks out the newest release tag (or pulls `origin/master` if none exist yet — refusing to
continue if there are uncommitted local changes), then rebuilds and restarts the Docker stack with
whichever compose overlays match your `.env` (adds `docker-compose.mongo.yml` automatically when
`mongoHost=mongo`). See [Updating](https://github.com/j5guy/balancedwaypoints/wiki/Updating) on the
wiki for the full breakdown.

## Uninstalling

```bash
curl -fsSL https://raw.githubusercontent.com/j5guy/balancedwaypoints/master/uninstall.sh -o uninstall.sh
bash uninstall.sh
```

Or, from an existing checkout: `./uninstall.sh`.

**Destructive** — this permanently deletes the Docker containers/images/network for this
deployment, every named volume (logs, backups, and MongoDB data if internal — every account's
budget data, if this points at a real deployment), and the install directory itself (`.env`,
`certs/`, the source checkout — everything in it). It asks you to type `yes` to confirm before
touching anything; pass `--yes` to skip that prompt only if you're scripting this deliberately
(e.g. tearing down a CI/test deployment), since a piped `curl | bash -s -- --yes` never gives you
the chance to back out.

---

For the full guided-setup walkthrough, exactly what the installer does and where it needs `sudo`,
CI/CD internals, the admin area (users, LDAP, backups), and backup & restore in depth, see the
[wiki](https://github.com/j5guy/balancedwaypoints/wiki).

## License

GPLv3 — see [LICENSE](LICENSE).
