# What the setup script does

This is a line-by-line account of everything `install.sh` (the curl/wget-able entrypoint) and the
wizard it launches (`scripts/setup-wizard.js`) install, configure, write to disk, or send over the
network — for anyone who wants to know exactly what they're running before they run it, or is
troubleshooting a step that failed partway through. For the *usage* walkthrough (what the form asks
and what to pick), see the [Installation Guide](Installation-Guide.md). For what a later
`./update.sh` run does differently, see [Updating](Updating.md).

Nothing here runs with elevated privileges until explicitly noted, and every `sudo` prompt is
called out below — the script never silently escalates.

## The phases

Running `curl ... | bash` (or `./install.sh` from an existing checkout) does the following in
order:

0. **Clone the repo into the install directory** (skipped when run from an existing checkout —
   that checkout is used in place instead) — `git clone --depth 1` (or `--branch <ref>` if `--ref`/
   `BALANCEDWAYPOINTS_REPO_REF` was given), after installing `git`/`curl` first if either is
   missing.
1. **Install Node.js**, if it isn't already on `PATH`.
2. **Run `npm install`**, if `node_modules/` doesn't exist yet — installs this project's
   dependencies (Express, Mongoose, bcrypt, ldapjs, etc. — see `package.json`) from the public npm
   registry into `node_modules/` inside the repo. Nothing outside the repo is touched by this step.
3. **Launch the setup wizard** (`node scripts/setup-wizard.js`) — a small local web server that
   collects your `.env` values, then brings the Docker stack up. This is where the interesting
   stuff happens — see below.

Re-running `install.sh` later always reopens the wizard, prefilled with whatever's already in
`.env`. To redeploy/restart with the existing settings unchanged instead (e.g. after a code
update), use `./update.sh` (see [Updating](Updating.md)), not the wizard.

## Step 0: cloning the repo

Only when invoked via the curl one-liner (or run without an existing checkout present) — not when
run as `./install.sh` from inside a checkout that already has `scripts/setup-wizard.js`, which
operates in place instead.

- `ensure_curl_git` installs `git`/`curl` first if either is missing — `apt-get install -y git
  curl` (Debian/Ubuntu), `dnf install -y git curl` (Fedora/RHEL), or `yum install -y git curl`
  (older RHEL/CentOS), all via `sudo`. If none of those package managers is found, the script exits
  and asks you to install them manually.
- Clones into a temporary directory (`mktemp -d`) with `git clone --depth 1 [--branch <ref>]
  <repo url>`.
- If the target install directory (`/opt/balancedwaypoints` by default, or `--dir`/
  `BALANCEDWAYPOINTS_INSTALL_DIR`) doesn't exist yet, creates it via `sudo mkdir -p` then `sudo
  chown <you>:<your group>` — so every step after this one can write there without `sudo`.
- Copies the temporary clone into the install directory (`cp -a ... /.`) and removes the temporary
  one.

## Step 1: installing Node.js

Only runs if `node` isn't found on `PATH`:

- **`apt-get` systems**: installs `curl` first via `apt-get` if it's missing, then NodeSource's
  install script — `curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -` followed by
  `sudo apt-get install -y nodejs`.
- **`dnf` systems**: the RPM equivalent — `curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo
  bash -` followed by `sudo dnf install -y nodejs`.
- Neither found: the script exits and points you at
  [nodejs.org](https://nodejs.org/) to install manually.

## Step 2: installing npm dependencies

Only runs if `node_modules/` doesn't already exist (so a re-run doesn't redo it every time). Plain
`npm install` from the project root, pulling this project's dependencies from the public npm
registry into `node_modules/`. Nothing outside the repo is touched — no system-wide packages, no
config written anywhere else.

## Step 3: the setup wizard

`scripts/setup-wizard.js` starts a plain Express server bound to your machine (not the public
internet), on an OS-assigned free port (`app.listen(0, ...)`), and prints the URL:

```
Open this URL in a browser to continue setup:
  http://localhost:<port>/
```

It reads `.env.example` to build the form's field list, labels, help text, and defaults, and (if
`.env` already exists from a previous run) prefills every field from it. Masked fields
(`mongoPass`, `LDAP_BIND_PASSWORD`) render as password inputs; `sessionSecret` and `MONGO_IMAGE` are
never shown in the form at all — they're computed/detected automatically (see below).

While the form is open, the wizard also checks whether this CPU needs the legacy ARM-compatible
MongoDB image (reading `/proc/cpuinfo` for the `atomics` feature flag, Linux/arm64/arm only — see
[Installation Guide](Installation-Guide.md#mongodb)) and shows a plain read-only warning next to the
MongoDB section if so — there's no field to fill in for this, it's informational only until you
submit.

### Submitting the form (`POST /save`)

1. **Resolves every field's value** — from what you typed, falling back to whatever was already in
   `.env`, falling back to `.env.example`'s default.
2. **Forces `mongoHost=mongo`** if "Internal MongoDB" was selected, regardless of what was typed
   into that (disabled) field.
3. **Reuses or generates `sessionSecret`** — `crypto.randomBytes(64).toString('hex')`, generated
   locally and never sent anywhere; kept from `.env` on a re-run rather than regenerated (which
   would invalidate every existing login session and CSRF token).
4. **Sets `MONGO_IMAGE`** to the legacy ARM-compatible tag if the CPU check above applies,
   otherwise leaves it blank so `docker-compose.mongo.yml`'s own default (`mongo:7`) is used.
5. **(Only if "Generate one" was picked for the TLS certificate) Generates a local TLS
   certificate.** Entirely local, via the `openssl` CLI — nothing is sent over the network:
   - Creates (or reuses, if `certs/ca.key`/`certs/ca.pem` already exist) a local Certificate
     Authority: `openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes -keyout certs/ca.key
     -out certs/ca.pem -subj "/CN=Balanced Waypoints Local CA"`.
   - Issues a leaf certificate for whatever you typed into "Domain name (or IP)", with SAN entries
     covering that domain/IP, every LAN IP address this host has, `localhost`, and `127.0.0.1`:
     `openssl req -newkey rsa:2048 -nodes -keyout certs/cert.key -out certs/cert.csr -subj
     "/CN=<domain>"`, then `openssl x509 -req -in certs/cert.csr -CA certs/ca.pem -CAkey
     certs/ca.key -CAcreateserial -out certs/cert.pem -days 825 -sha256 -extfile certs/cert.ext`.
   - **This certificate isn't trusted by anything yet** — see
     [Import the certificate before visiting the site](Installation-Guide.md#submitting-the-form)
     in the Installation Guide. If "I'll provide my own certificate files" was picked instead, your
     `SSL_CERT_FILE`/`SSL_KEY_FILE` paths are used as-is — nothing is generated.
6. **Writes `.env`** at the project root with everything resolved above.
7. **Installs Docker, only now that it's actually needed** (this project is Docker-only, so this
   always runs unless Docker is already present) — never preemptively during steps 0–2:
   - Installs `curl` first if missing (same package-manager detection as Step 1).
   - Runs Docker's official convenience script: `curl -fsSL https://get.docker.com | sudo sh`.
   - `sudo systemctl enable --now docker` (starts Docker, sets it to start on boot).
   - `sudo usermod -aG docker <your username>` (lets you run `docker` without `sudo` afterward —
     needs a fresh login or `newgrp docker` to take effect).
   - If any of this fails, the script prints the compose command you'd need to run manually and
     exits — nothing further happens automatically.
8. **Runs `docker compose -f docker-compose.yml -f docker-compose.nginx.yml [-f
   docker-compose.mongo.yml] up -d --build`** — always builds the image from this checkout; the
   Mongo overlay is included only in Internal MongoDB mode. This is what actually builds and starts
   the containers: `app` (this application), `nginx` (TLS termination, reading the cert from step 5
   or your own files), and `mongo` (only if internal MongoDB was picked).
9. **Prints where the app is reachable**: `https://<WEB_FQDN>:<port>/` plus
   `https://<lan-ip>:<port>/` for every LAN IP address this host has (loopback/Docker-bridge/VPN
   interfaces are filtered out — see `scripts/lib/network.js`), highlighted in the terminal when
   stdout is a real TTY and `NO_COLOR` isn't set.

## Everything written to disk, in one place

| Path | What | Committed to git? |
| --- | --- | --- |
| `node_modules/` | npm dependencies | No (`.gitignore`) |
| `.env` | Your secrets/config | No (`.gitignore`) |
| `certs/ca.key`, `certs/ca.pem` | Local CA, only if you picked "Generate one" | No (`.gitignore`) |
| `certs/cert.key`, `certs/cert.pem`, `certs/cert.csr`, `certs/cert.ext` | Leaf cert issued by the above | No (`.gitignore`) |
| `public/css/main.css` | Compiled from `public/scss/` (Docker image build; also written locally by `npm run build-css`) | No (`.gitignore`) |

## Everything that touches the network

- **Package managers/installers**, only for whatever's actually missing: NodeSource/`apt-get`/
  `dnf` (Node.js), `get.docker.com` (Docker Engine).
- **The npm registry**, for `npm install` — both directly and inside the Docker image build.
- **Docker Hub**, to pull the base image the Docker image is built from the first time you build
  locally (cached after that), plus `nginx:alpine` and (if Internal MongoDB) `mongo:7` or the ARM
  fallback tag for the bundled containers.
- **Whatever you configure**: the MongoDB host (if External) and LDAP server (if enabled) — the app
  talks to those once it's running, same as any deployment.
- **Nothing else.** The wizard's own web server is local-only and never phones home; there's no
  telemetry or analytics anywhere in this project.

## Privilege escalation, called out explicitly

`sudo` is used only for:

- Installing `git`/`curl` if missing (Step 0), before the repo is even cloned.
- Installing Node.js system packages (Step 1).
- Creating and `chown`-ing the install directory the first time (Step 0, curl-one-liner path only).
- Installing Docker, then `sudo systemctl enable --now docker` and `sudo usermod -aG docker <you>`
  (only once Docker deployment is actually being brought up — see Step 3.7 above).

If `sudo` isn't available at all (and you're not already root), the relevant step fails with a
message telling you so rather than silently skipping it.

## Re-running later

Re-running `install.sh` after `.env` already exists always reopens the wizard, prefilled with your
current values. To instead just redeploy/restart with what's already there — most commonly, to pick
up a newer release — use `./update.sh` (see [Updating](Updating.md)) rather than reopening the
wizard.
