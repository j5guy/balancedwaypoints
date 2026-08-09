# Installation Guide

For the quick-start commands, see
[Installation](https://github.com/j5guy/balancedwaypoints#installation) in the README. This page
covers the full guided-setup walkthrough in detail, doing it by hand instead, and local
development. For a step-by-step account of exactly what the setup script installs, writes to disk,
and sends over the network, see
[What the Setup Script Does](What-the-Setup-Script-Does.md). Already installed and want to update
instead? See [Updating](Updating.md).

**The [guided install](#guided-install) below is the quickest and easiest way to get running.**

## Guided install

One command installs whatever's missing (git, curl, Node.js), clones the repo into the install
directory, installs npm dependencies, and hands off to the setup wizard — no `git clone`/`mkdir`
needed first:

```bash
curl -fsSL https://raw.githubusercontent.com/j5guy/balancedwaypoints/master/install.sh | bash
```

Defaults to `/opt/balancedwaypoints` — override with `--dir /some/other/path`, or the
`BALANCEDWAYPOINTS_INSTALL_DIR` environment variable. That directory is created for you (`sudo
mkdir` + `chown` to your own user), so nothing after that needs `sudo` or leaves root-owned files
behind. `--ref <branch-or-tag>` (or `BALANCEDWAYPOINTS_REPO_REF`) clones a specific ref instead of
the default branch.

Already have a checkout, or want to review the script first? `git clone` it and run `./install.sh`
from inside it instead — this operates in place, with no scratch clone or `--dir` involved:

```bash
git clone https://github.com/j5guy/balancedwaypoints.git
cd balancedwaypoints
./install.sh
```

Node.js is installed if missing (NodeSource on Linux, via `apt-get`/`dnf`); `git`/`curl` are
installed first via `apt-get`/`dnf`/`yum` if either is missing and this isn't an in-place run.
**Docker is not installed at this stage** — only once you actually pick a Docker-related step
inside the wizard (which is unconditional here, since this project is Docker-only) does the
installer attempt it, via `get.docker.com`.

### Installation footprint

Only offered by the curl one-liner above (not the in-place `./install.sh` from an existing
checkout — there's nowhere else for that checkout's source to go):

- **Docker only, minimal footprint** (default, recommended) — builds the image from the scratch
  clone, then deletes the source entirely, leaving just `docker-compose.yml`, `.env`, `certs/`,
  `nginx/`, `.deploy-state.json`, and `update.sh` at the install directory.
- **Full checkout** — keeps the full source at the install directory instead, same as every install
  before this choice existed.

Either way, `./update.sh` afterward is the same one command — see [Updating](Updating.md), which
now handles both footprints.

## The setup wizard

`scripts/setup-wizard.js` is a small Express server that reads `.env.example` for the field list,
help text, and defaults, serves a form on an OS-assigned local port, and prints the URL:

```
Open this URL in a browser to continue setup:
  http://localhost:<port>/
```

It's bound to this machine only — not the public internet. If you're on a headless server, open
that URL from a browser on the same machine (e.g. over SSH port forwarding), or reach it by this
host's own address if the wizard's listening port happens to be reachable on your network.

The form has three sections:

### MongoDB

- **Internal** (default, recommended) — brings up a bundled `mongo` container and sets
  `mongoHost=mongo` automatically. The `mongoHost`/`mongoUser`/`mongoPass` fields are disabled in
  the form in this mode (there's nothing to fill in).
- **External** — point at an existing MongoDB server. Enables the `mongoHost`, `mongoUser`, and
  `mongoPass` fields for you to fill in.

> **ARM CPUs and MongoDB:** MongoDB 5.0+ (and 4.4.19+) require the ARMv8.2-A instruction set, which
> older ARM hardware (e.g. Raspberry Pi 4 and earlier) doesn't implement. If you pick Internal
> MongoDB, the wizard checks this host's CPU (reading `/proc/cpuinfo` for the `atomics` feature
> flag — only actually runs the check on Linux/arm64/arm) and shows a plain notice next to the
> MongoDB section when it needs to fall back — `MONGO_IMAGE` in `.env` is set to `mongo:4.4.18`
> automatically in that case, otherwise left blank so `docker-compose.mongo.yml`'s own default
> (`mongo:7`) applies. There's nothing to fill in either way; to override the auto-detected choice
> later, edit `MONGO_IMAGE` directly in `.env`.

### TLS certificate

- **Generate one** (default, recommended) — creates a local Certificate Authority the first time
  you use it (or reuses one already at `certs/ca.key`/`certs/ca.pem` from a previous run), then
  issues a leaf certificate for whatever you type into "Domain name (or IP)" below, signed by that
  CA. The certificate's SAN list covers that domain/IP, every LAN IP address this host has, plus
  `localhost` and `127.0.0.1`. No real domain or public CA needed.
- **I'll provide my own certificate files** — enables the `SSL_CERT_FILE`/`SSL_KEY_FILE` fields
  (disabled otherwise), which should be host paths to your own cert/key pair.

### Configuration

Everything from `.env.example`, each field labeled and with its help text shown underneath — most
notably:

- **Domain name (or IP)** (`WEB_FQDN`, required — the only field the form itself won't let you
  submit blank) — what you'll access the app at.
- **HTTPS port** / **HTTP port (redirects to HTTPS)** (`NGINX_HTTPS_PORT`/`NGINX_HTTP_PORT`,
  default `5570`/`80`) — the host-side ports the bundled Docker nginx binds to. The app itself
  always answers on `5570` inside the container — not configurable, and never exposed directly
  when nginx is in front of it.
- **Certificate file** / **Certificate key file** (only enabled when "I'll provide my own" is
  picked above).
- **Always-admin email** (`ADMIN_EMAIL`, optional) — see [First account](#first-account) below.
- **Currency symbol** (`CURRENCY_SYMBOL`, default `$`).
- **MongoDB username / password / port / database name** (only enabled in External mode).
- **LDAP fields** — `LDAP_ENABLED`, `LDAP_URL`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`,
  `LDAP_SEARCH_BASE`, `LDAP_SEARCH_FILTER` (the last must contain the literal `{{username}}`
  placeholder — e.g. `(sAMAccountName={{username}})` for Active Directory, `(uid={{username}})` for
  OpenLDAP). All optional — leave blank to skip LDAP entirely at install time; it can be configured
  or changed later from Admin &gt; LDAP without a redeploy (see [Admin Area](Admin-Area.md)), and
  settings saved there take priority over these `.env` values.

`sessionSecret` and `MONGO_IMAGE` are generated/set automatically and never shown in the form —
`sessionSecret` is `crypto.randomBytes(64).toString('hex')`, generated once and then reused on
every re-run of the wizard against an existing `.env`.

Re-running `./install.sh`/`node scripts/setup-wizard.js` later reopens the form, prefilled with
whatever's already in `.env` (mongo/cert mode inferred from the existing values) — use this to
change a setting. To just redeploy/restart with existing settings unchanged instead (e.g. after a
code update), use `./update.sh` (see [Updating](Updating.md)) rather than reopening the wizard.

### Submitting the form

`POST /save` does the following, in order:

1. If "Generate one" was picked for the TLS certificate, generates it via the local `openssl` CLI
   (see [What the Setup Script Does](What-the-Setup-Script-Does.md#certificate-generation) for the
   exact commands).
2. Writes `.env` at the project root with everything you filled in, plus the auto-generated
   `sessionSecret` and, if applicable, the auto-detected `MONGO_IMAGE`.
3. Installs Docker if it isn't already present (`get.docker.com`, then `sudo systemctl enable --now
   docker` and `sudo usermod -aG docker <you>` on Linux).
4. If "Docker only, minimal footprint" was picked: builds the image, writes a small
   self-contained `docker-compose.yml` (no build context), copies `nginx/nginx.conf.template` and
   `update.sh` into the install directory, brings the stack up from there, then deletes the scratch
   checkout. If "Full checkout" was picked instead: moves the checkout to the install directory as-is,
   then runs `docker compose -f docker-compose.yml -f docker-compose.nginx.yml [-f
   docker-compose.mongo.yml] up -d --build` there (the Mongo overlay is only included in Internal
   MongoDB mode). Either branch writes `.deploy-state.json` recording which footprint/MongoDB mode
   was chosen, for `update.sh` to read later (see [Updating](Updating.md)).
5. Prints the URL(s) the app is reachable at: `https://<WEB_FQDN>:<port>/` plus
   `https://<lan-ip>:<port>/` for every LAN IP address this host has.

> **Import the certificate before visiting the site.** Unless `SSL_CERT_FILE`/`SSL_KEY_FILE` point
> at a certificate from a public CA (e.g. Let's Encrypt), your browser won't trust it yet — whether
> it's the one the wizard generated or one you supplied. The completion page offers a download link
> for the CA certificate (for a generated one); install it — or your own self-signed/private CA —
> into the OS/browser trust store of every device that needs to reach the site, *before* visiting
> it there. If the download itself is blocked by your browser, the same file always sits on the
> host at `certs/ca.pem`, outside Docker entirely.

## First account

Then visit `/auth/signup` on one of the printed URLs. **The first person to sign up automatically
becomes admin, regardless of `ADMIN_EMAIL`** — signup is always open, and every account gets its
own separate, empty set of accounts/categories/budget, so there's no "lock it down once everyone's
in" step. Set `ADMIN_EMAIL` if you want a *specific* email to always become admin, even on a signup
after the first one.

There's also a CLI bootstrap, useful before the web signup flow is reachable or for recovering
admin access:

```bash
node scripts/createUser.js <email> --password <password> [--admin]
```

Run it inside the container (`docker compose exec app node scripts/createUser.js ...`) or, in local
dev mode, directly on the host — either way it connects using this deployment's own `.env`.

## Manual `.env` setup instead of the wizard

1. Copy `docker-compose.yml`, `docker-compose.nginx.yml`, `docker-compose.mongo.yml` (if using
   internal MongoDB), and `.env.example` to the deploy host, `cp .env.example .env`, and fill it
   in:
   - `sessionSecret` — generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`.
   - `mongoHost` — `mongo` if using the bundled container, otherwise your external server's
     host/IP (plus `mongoUser`/`mongoPass` if it needs auth).
   - `SSL_CERT_FILE`/`SSL_KEY_FILE` — your own cert/key pair, or generate a self-signed one:
     ```bash
     openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
       -keyout certs/ca.key -out certs/ca.pem -subj "/CN=Local CA"
     openssl req -newkey rsa:2048 -nodes -keyout certs/cert.key -out certs/cert.csr \
       -subj "/CN=<your WEB_FQDN>"
     openssl x509 -req -in certs/cert.csr -CA certs/ca.pem -CAkey certs/ca.key -CAcreateserial \
       -out certs/cert.pem -days 825 -sha256 \
       -extfile <(echo "subjectAltName=DNS:<your WEB_FQDN>,IP:<your server's LAN IP>,IP:127.0.0.1")
     ```
     then install `certs/ca.pem` into your OS/browser trust store on any device that needs to reach
     the site without a warning.
   - `ADMIN_EMAIL`, `CURRENCY_SYMBOL`, and the `LDAP_*` fields as needed — see
     [`.env.example`](../../.env.example) for the full list with inline help text.
2. `docker compose -f docker-compose.yml -f docker-compose.nginx.yml up -d --build` (add
   `-f docker-compose.mongo.yml` for internal MongoDB).

This brings up the app plus the bundled nginx container, and, if you included the MongoDB overlay,
a bundled MongoDB container (data persisted in the `mongo-data` Docker volume). `logs-data` and
`backups-data` volumes are always present via the base `docker-compose.yml`.

### Pointing MongoDB at your own server

Delete/omit `docker-compose.mongo.yml` from every command above, and set `mongoHost` (plus
`mongoUser`/`mongoPass` if it needs auth) to your server's address in `.env`.

### Pulling a pre-built image instead of building

`docker-compose.pull.yml` supplies an `image:` key for `app` so `docker compose ... pull` +
`up -d` can be used instead of `--build`. This project doesn't publish a pre-built image itself
(see [CI/CD and Releases](CI-CD-and-Releases.md)) — set `BALANCEDWAYPOINTS_IMAGE` in `.env` to
wherever you build/push your own first:

```bash
docker compose -f docker-compose.yml -f docker-compose.nginx.yml -f docker-compose.pull.yml pull
docker compose -f docker-compose.yml -f docker-compose.nginx.yml -f docker-compose.pull.yml up -d
# add -f docker-compose.mongo.yml too if you also want internal MongoDB
```

## Local development (no Docker)

```bash
npm install
npm run build-css      # or npm run watch-css while developing
cp .env.example .env   # set mongoHost=localhost (or wherever a local Mongo runs) and sessionSecret
echo "NODE_ENV=development" >> .env
node server.js
```

The app listens on port 5570 directly (no nginx in front) in this mode, over plain HTTP.

> **`NODE_ENV=development` is required here.** Without it, `config/config.js` defaults to
> `production`, which makes the session and CSRF cookies `Secure`-only (the CSRF cookie is even
> `__Host-`-prefixed, which browsers refuse to set at all over plain HTTP). Leaving `NODE_ENV`
> unset is only safe behind the bundled/Docker nginx, which actually terminates TLS — never leave
> it unset while serving plain HTTP directly.

MongoDB isn't bundled this way — point `mongoHost` in `.env` at an existing server, or run a
standalone container for it:

```bash
docker run -d --name balancedwaypoints-mongo --restart unless-stopped \
  -p 127.0.0.1:27017:27017 -v balancedwaypoints-mongo-data:/data/db mongo:7
```
