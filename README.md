# Balanced Waypoints

Envelope budgeting, schedules, rules, and payees for your household finances — a
self-hosted, Quicken/Actual-Budget-style personal finance app.

## Features

- **Accounts** — checking, savings, credit cards, cash, investments, loans; on-budget vs. off-budget/tracking.
- **Transactions** — split transactions across multiple categories, transfers between accounts, tags, cleared/reconciled status.
- **Envelope budgeting** — assign a dollar amount to each category per month, with a rolling balance and a "Ready to Assign" figure.
- **Payees** — with a default category to speed up entry, and transfer payees.
- **Rules** — auto-categorize, rename payees, and tag transactions on import based on conditions you define.
- **Schedules** — recurring transactions (bills, paychecks) that either auto-enter into the register or just remind you they're coming due.
- **Import** — CSV (tolerant bank-export column detection) and OFX/QFX, with duplicate detection and rule-based suggestions before you commit.
- **Reports** — spending by category, income vs. expense, net worth over time.
- **LDAP login** (optional) — log in against Active Directory/OpenLDAP alongside local accounts, configurable at install time or later from Admin > LDAP.
- **Email notifications** — each person configures their own outgoing mail server from My Account; per-schedule "email when due" alerts and an opt-in weekly summary go out through it.
- **Backups** — manual or scheduled, with a destination location and retention you choose and a check that the location is actually reachable before it's relied on. Admins back up the whole site from Admin > Backups; anyone can also back up just their own data from My Account > Backups. Restoring is supported from either page.

## Quick install

```
curl -fsSL https://raw.githubusercontent.com/j5guy/balancedwaypoints/master/install.sh | bash
```

This installs Docker, Node.js, and git if missing, then walks you through a guided
setup (domain, admin email, MongoDB, TLS cert) and brings up the Docker stack.

## Manual setup

```
git clone https://github.com/j5guy/balancedwaypoints.git
cd balancedwaypoints
npm install
cp .env.example .env   # fill in the values, or run the wizard instead:
node scripts/setup-wizard.js
```

Or without Docker, for local development:

```
npm install
npm run build-css
node server.js
```

## Updating

```
cd /opt/balancedwaypoints && ./update.sh
```

## Uninstalling

```
cd /opt/balancedwaypoints && ./uninstall.sh
```

## Documentation

See the [wiki](docs/wiki/Home.md) for the installation guide, admin area, and CI/CD notes.

## License

GPLv3 — see [LICENSE](LICENSE).
