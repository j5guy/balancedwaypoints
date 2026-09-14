# CI/CD and Releases

Two Gitea Actions workflows (`.gitea/workflows/test.yml` and `.gitea/workflows/prod.yml`) mirror
the pattern used by this project's sibling apps (`loadout`, `workouts`, `fondwaypoints`): deploy
straight to a running Node.js process on a self-managed host on every push. `prod.yml` additionally
builds and publishes a Docker image (see [Docker image publishing](#docker-image-publishing) below).

## `test.yml` — push to `test`

Runs on a Gitea Actions runner labeled `web-test`. On every push to the `test` branch:

1. Clones the repo to `/var/www/html/balancedwaypoints` if it isn't there yet, otherwise
   `git reset --hard HEAD` + `git pull` (branch `test`) to bring it up to date, discarding any
   local drift on that host.
2. `npm install`.
3. Compiles CSS: `npx sass public/scss/main.scss public/css/main.css`.
4. Ensures a `balancedwaypoints.service` systemd unit exists (creates it, pointed at `npm start`,
   logging to `/var/log/node/logs/balancedwaypoints_{app,err}.log`, if it doesn't already), then
   `systemctl restart balancedwaypoints`.

No release is cut, and nothing is pushed to GitHub, from this workflow — it only updates the
`test`-labeled deployment host.

## `prod.yml` — push to `master`

Runs on a Gitea Actions runner labeled `web-prod`. On every push to `master`:

1. Clone-or-pull the same way as `test.yml`, into `/var/www/html/balancedwaypoints` on the
   `web-prod` host, `npm install`, compile CSS, `systemctl restart balancedwaypoints` — the same
   deploy steps as `test.yml`, just against the prod host and without the "create the unit if
   missing" step (it's assumed to already exist there).
2. **Mirrors `master` to GitHub** — `git push --force` to
   `github.com/j5guy/balancedwaypoints.git` `HEAD:master`, authenticated with the
   `GHCR_TOKEN` secret. This is a force push, so GitHub's `master` always exactly matches
   Gitea's — don't expect GitHub-side commits to `master` to survive the next push.
3. **Reads the version from `package.json`** (`grep '"version"'` + `sed`) into `VERSION`.
4. **Creates a GitHub release**, tagged `v<VERSION>`, if one for that tag doesn't already exist
   (checked via a `GET` to `/releases/tags/<tag>` first) — with auto-generated release notes
   (`generate_release_notes: true`). Bump `version` in `package.json` to publish a new one; pushing
   again at the same version is a no-op for this step.
5. **Creates a matching Gitea release** the same way, against this repo's own Gitea API
   (`GITEA_HOST`/`GITEA_REPO`), authenticated with the `LOCAL_GITEA_REGISTRY_TOKEN` secret.
6. **Builds and pushes the Docker image** — see [Docker image publishing](#docker-image-publishing).

[`RELEASE_NOTES`](https://github.com/j5guy/balancedwaypoints/blob/master/RELEASE_NOTES) at the repo
root is a separate, hand-written changelog (one entry per version) — distinct from either release's
auto-generated notes, and not something this workflow touches; update it yourself alongside a
version bump if you want a human-readable summary of what changed.

## Docker image publishing

`prod.yml` also builds and publishes a Docker image on every push to `master`, after the release
steps above — tagged with both `:latest` and the exact version read from `package.json`, and pushed
to two registries: the internal Gitea registry (`gitea.pinkham.lan/allthewaypoints/balancedwaypoints`)
and GHCR (`ghcr.io/j5guy/balancedwaypoints`). This is what makes `dist-example/docker-compose.yml` and
`docker-compose.pull.yml` — which reference `ghcr.io/j5guy/balancedwaypoints:latest` — actually work
as written; before this, self-hosters had to use `docker-compose.yml`'s default `build: .` instead of
pulling.

## Infrastructure this repo doesn't provision

These workflows assume infrastructure that lives outside this repository — set it up the same way
the sibling projects' hosts are configured before relying on these workflows; until then, they're
inert (a push will simply fail or do nothing useful):

- A Gitea Actions runner labeled `web-test`, and another labeled `web-prod`, each with `git`,
  Node.js/`npm`, and `npx sass` available, and (`prod.yml` only) `curl` for the release API calls.
- A `balancedwaypoints` systemd service already reachable by `systemctl` on each of those hosts —
  `test.yml` creates the unit file itself if it's missing; `prod.yml` assumes it already exists.
- Repository secrets, under **Settings → Actions → Secrets** on the Gitea repo (`prod.yml`
  only — `test.yml` needs none):
  - `GHCR_TOKEN` — a GitHub personal access token (`repo` scope, plus `write:packages` for GHCR).
    Authenticates the force-push to GitHub, the GitHub release creation, and the GHCR login.
  - `GHCR_USER` — the GitHub username that token belongs to, for the GHCR `docker login`.
  - `LOCAL_GITEA_REGISTRY_TOKEN` — a Gitea access token. Authenticates the Gitea release creation and
    the Gitea container registry login.
  - `LOCAL_GITEA_REGISTRY_USER` — the Gitea username that token belongs to, for that `docker login`.
- `docker` available on the `web-prod` runner host (for the image build/push steps) — not required
  on `web-test`.

## Cutting a release by hand instead

Bump `version` in `package.json`, commit, and push to `master` — the workflow above handles tagging
and both releases automatically as long as the infrastructure above is in place. There's no
separate manual tag-and-push step needed; pushing the version bump *is* what triggers the release.
