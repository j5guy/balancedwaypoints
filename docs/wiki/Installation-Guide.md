# Installation Guide

**Docker Compose only** — one self-contained `docker-compose.yml`, no `.env` file, no setup wizard,
no reverse proxy to stand up first.

## Quick start

```bash
mkdir balancedwaypoints && cd balancedwaypoints
curl -O https://raw.githubusercontent.com/j5guy/balancedwaypoints/master/dist-example/docker-compose.yml
docker compose up -d && docker compose logs app
```

Every setting in that file already has a working default — bundled MongoDB, plain HTTP on port
5570, no admin bootstrapped (sign up normally instead). `docker compose logs app` prints the URL to
open once the container's up.

## Configuration

Everything lives as `environment:` entries directly in the `docker-compose.yml` you downloaded —
edit the file and `docker compose up -d` again to apply changes. The file itself documents each
variable inline; the notable ones:

- **`WEB_FQDN`** — the hostname/IP this app is reachable at. Purely cosmetic (what gets printed in
  the startup log line) — a container can't detect its own host's LAN IP, so set this yourself if
  you want that printed URL to work from other devices.
- **`WEB_PROTOCOL`** — `http` (default) or `https`. Purely cosmetic too (which scheme links in
  emails use) — set it to `https` once you've enabled TLS below or put a reverse proxy in front.
- **`ADMIN_EMAIL`/`ADMIN_PASSWORD`** — set both to have an admin account ready before anyone signs
  up. Leave either blank and nothing is bootstrapped — no default/weak password is ever created; the
  first account created through `/auth/signup` is always made admin regardless of this setting.
- **`mongoHost`/`mongoPort`/`mongoDBName`/`mongoUser`/`mongoPass`** — point at the bundled `mongo`
  service (the default) or an external MongoDB server. Set **`MONGO_URI`** instead of that whole
  block to use a `mongodb+srv://` connection string (e.g. MongoDB Atlas).
- **`LDAP_*`** — optional, alongside local accounts, never a replacement — see
  [Admin Area](Admin-Area.md#ldap). Can also be configured later from Admin → LDAP without a
  redeploy.
- **`DEMO_MODE`** — turns this into a public try-it-yourself instance that wipes the entire database
  nightly. Never set this on a real deployment.

## TLS / HTTPS

Plain HTTP by default. Two ways to get HTTPS, either or neither:

1. **Self-service** — once the app is running, go to Admin → Settings and upload a certificate and
   private key. This app terminates HTTPS itself from then on, on the same port, no container
   restart needed (it swaps its own listener). Disable it the same way to go back to plain HTTP.
2. **Your own reverse proxy** — put Traefik, Caddy, nginx, or anything else you already run in front
   of this app instead, and leave TLS off here.

Either way, set `WEB_PROTOCOL: https` in `docker-compose.yml` afterward so links this app generates
itself use the right scheme.

## Data at rest

Payee name/address/phone/account-number, and every notes/memo field (transactions, split lines,
accounts, schedules and their occurrence overrides), are AES-256-GCM encrypted before they're ever
written to MongoDB — the same mechanism and key (`sessionSecret`) already used for the LDAP bind
password. Amounts, dates, categories, tags, and account balances are left in the clear, so budgets,
reports, and aggregations keep running inside MongoDB instead of requiring every query to decrypt
and recompute in the app.

This protects against someone reading the database files/backups directly (a stolen disk, a leaked
`mongodump`, an over-shared volume) without also having `sessionSecret`. It does **not** replace
disk/volume encryption — MongoDB Community (the bundled `mongo` image) has no encrypted storage
engine of its own, so if you want the whole data directory protected too (not just these fields),
encrypt the volume/disk it lives on at the OS level (LUKS, BitLocker, FileVault, or your cloud
provider's disk encryption).

`sessionSecret` has no rotation path today — rotating it (or losing it) makes every already-encrypted
field permanently unreadable, since the encryption key is derived directly from it. Back it up
alongside your database, the same way you'd back up a disk encryption key.

If you're upgrading an existing install from before this feature existed, run the one-time migration
after upgrading (back up your database first):

```bash
docker compose exec app node scripts/encryptExistingData.js
```

Safe to re-run — it only touches documents that still have the old plaintext field.

## First account

The first person to sign up (`/auth/signup`) always becomes admin, regardless of `ADMIN_EMAIL` —
signup is always open, and every account gets its own separate, empty set of accounts/categories/
budget (see [README: What makes this different](https://github.com/j5guy/balancedwaypoints#what-makes-this-different-from-a-normal-self-hosted-app)).
`ADMIN_EMAIL` only matters for making a *later* signup an admin too, or (combined with
`ADMIN_PASSWORD`) for having an admin account bootstrapped before anyone signs up at all.

There's also a CLI bootstrap for creating an account before the web signup flow is reachable, or for
recovering admin access:

```bash
docker compose exec app node scripts/createUser.js <email> --password <password> [--admin]
```

## Building from source instead of pulling

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

## Local development (no Docker)

```bash
npm install
npm run build-css      # or npm run watch-css while developing
export sessionSecret=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
export mongoHost=localhost mongoPort=27017 mongoDBName=balancedwaypoints
export NODE_ENV=development
node server.js
```

The app listens on port 5570 directly, over plain HTTP.
