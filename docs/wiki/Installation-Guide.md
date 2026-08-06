# Installation Guide

## Guided install (recommended)

```
curl -fsSL https://raw.githubusercontent.com/j5guy/balancedwaypoints/master/install.sh | bash
```

This installs git/curl/Node.js if missing, clones the repo to
`/opt/balancedwaypoints` (override with `--dir` or `BALANCEDWAYPOINTS_INSTALL_DIR`),
installs npm dependencies, and hands off to `scripts/setup-wizard.js`.

The wizard serves a form on `http://localhost:<random port>/` — open the
printed URL, fill in:

- **MongoDB** — Internal (bundled container, recommended) or External (point at your own).
- **TLS certificate** — generate a self-signed one, or provide your own cert/key files.
- **Domain/IP, ports, admin email, currency symbol, MongoDB settings.**

Submitting writes `.env`, generates a cert if requested, and runs
`docker compose up -d --build`. The app is Docker-only — there is no local
systemd service mode (unlike `workouts`/`fondwaypoints`, which support both).

## Manual install

```
git clone https://github.com/j5guy/balancedwaypoints.git
cd balancedwaypoints
cp .env.example .env   # fill in the values
docker compose -f docker-compose.yml -f docker-compose.nginx.yml -f docker-compose.mongo.yml up -d --build
```

Omit `-f docker-compose.mongo.yml` if pointing `mongoHost` at an external
MongoDB server instead of the bundled container.

## Local development (no Docker)

```
npm install
npm run build-css      # or npm run watch-css while developing
cp .env.example .env   # set mongoHost=localhost (or wherever a local Mongo runs) and sessionSecret
echo "NODE_ENV=development" >> .env
node server.js
```

The app listens on port 5570 directly (no nginx in front) in this mode, over
plain HTTP. **`NODE_ENV=development` is required here** — without it,
`config/config.js` defaults to `production`, which makes the session and CSRF
cookies `Secure`-only (the CSRF one is even `__Host-`-prefixed, which browsers
refuse to set over plain HTTP at all). Leaving `NODE_ENV` unset is only safe
behind the bundled/Docker nginx, which actually terminates TLS.

## First account

The first person to sign up (at `/auth/signup`) automatically becomes admin,
regardless of `ADMIN_EMAIL`. Signup is always open — each account gets its
own separate, empty set of accounts/categories/budget, so there's no "lock
it down once everyone's in" step anymore.
