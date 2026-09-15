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
- **Docker-only, deliberately simple.** One self-contained `docker-compose.yml` — bundled MongoDB,
  no `.env` file, no setup wizard, no reverse proxy to stand up first. `docker compose up -d` and
  you're done; see Installation below.

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
  configurable via env vars at install time or later from Admin &gt; LDAP without a redeploy. The bind
  password is AES-256-GCM encrypted at rest, keyed off `sessionSecret`.
- **Encryption at rest** — payee name/address/phone/account-number, and every notes/memo field
  (transactions, split lines, accounts, schedules, and their occurrence overrides) are AES-256-GCM
  encrypted before they're written to MongoDB, keyed off `sessionSecret` just like the LDAP bind
  password above. Amounts, dates, categories, and account balances are stored in the clear so
  budgets/reports/aggregations keep running in the database — see
  [docs/wiki/Installation-Guide.md](docs/wiki/Installation-Guide.md#data-at-rest) for what that
  does and doesn't protect against.
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

**Docker Compose only** — one self-contained file, nothing else to install first.

```bash
mkdir balancedwaypoints && cd balancedwaypoints
curl -O https://raw.githubusercontent.com/j5guy/balancedwaypoints/master/dist-example/docker-compose.yml
docker compose up -d && docker compose logs app
```

That's the whole thing — every setting in that file already has a working default. `docker compose
up -d` returns as soon as the container starts, so the trailing `docker compose logs app` is what
actually prints the access URL to your terminal. Sign up at `/auth/login` → Sign up — the first
account created is always made admin, regardless of `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Set those two in
the file first instead if you'd rather have an admin account ready to go before anyone signs up; no
default/insecure password is ever created if you leave them blank.

That printed URL uses `WEB_FQDN` (`localhost` by default) — a container can't detect its own host's
LAN IP, so set `WEB_FQDN` to this host's IP or hostname yourself in the `docker-compose.yml` you
downloaded if you want that link to work from other devices on your network.

Plain HTTP by default — this app can terminate its own HTTPS if you upload a certificate and key
from Admin → Settings once it's running, or put your own reverse proxy (Traefik, Caddy, nginx,
whatever you already run) in front of it instead. Either way, set `WEB_PROTOCOL: https` in the
compose file afterward so links this app generates itself (e.g. in emails) use the right scheme.

### Building from source instead of pulling

```bash
git clone https://github.com/j5guy/balancedwaypoints.git
cd balancedwaypoints
docker compose up -d --build
```

`docker-compose.pull.yml` is an overlay for a checkout like this one that pulls the published image
instead of building locally:

```bash
docker compose -f docker-compose.yml -f docker-compose.pull.yml up -d
```

### Local development (no Docker)

```bash
npm install
npm run build-css      # or npm run watch-css while developing
export sessionSecret=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
export mongoHost=localhost mongoPort=27017 mongoDBName=balancedwaypoints
export NODE_ENV=development
node server.js
```

The app listens on port 5570 directly, over plain HTTP. There's a CLI bootstrap for creating an
account before the web signup flow is reachable, or for recovering admin access:

```bash
node scripts/createUser.js <email> --password <password> [--admin]
```

## Updating

```bash
docker compose up -d
```

Relies on `pull_policy: always` in the published-image compose files — re-run the same command any
time a new release comes out. Building from source instead: `git pull && docker compose up -d --build`.

## Uninstalling

```bash
docker compose down -v
```

`-v` also removes the named volumes — including MongoDB data, uploads, backups, and the
auto-generated session secret. Omit it to stop the app while keeping everything on disk for a later
`docker compose up -d`.

---

For the admin area (users, LDAP, backups), backup & restore in depth, and CI/CD internals, see the
[wiki](https://github.com/j5guy/balancedwaypoints/wiki).

## License

GPLv3 — see [LICENSE](LICENSE).
