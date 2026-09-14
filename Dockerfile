# Debian-based (not alpine) so bcrypt's prebuilt native binary works without
# compiling from source, on the platforms it has one for (notably amd64).
FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
# build-essential/python3 are a fallback for platforms without a prebuilt
# bcrypt binary so npm can compile it from source instead of failing
# outright. Installed and purged within this one layer so they don't end up
# in the final image. gosu is a runtime dependency (drops root -> app in
# docker-entrypoint.sh, see below) — kept, unlike build-essential/python3.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 gosu \
    && npm install --omit=dev \
    && apt-get purge -y --auto-remove build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npx sass public/scss/main.scss public/css/main.css --style=compressed --no-source-map

RUN groupadd -r app && useradd -r -g app app \
    && mkdir -p logs public/uploads backups .secrets .secrets/tls \
    && chown -R app:app /app

# A random session secret, generated once at image-build time and baked in —
# nothing to enter, nothing to auto-generate at container start. Unique per
# `docker build` (a fresh value every time this image is built, including
# every published release), and persisted across container recreation the
# same way the rest of .secrets/ already is: the secrets-data volume (see
# docker-compose.yml) is seeded from this file on its first use, then keeps
# whatever's there. Override by setting the sessionSecret env var yourself
# (e.g. to share one value across a multi-instance deploy) — see
# docker-entrypoint.sh.
RUN node -e "require('fs').writeFileSync('.secrets/session-secret', require('crypto').randomBytes(64).toString('hex'))" \
    && chown app:app .secrets/session-secret

RUN chmod +x docker-entrypoint.sh

# No USER app here — the container starts as root so docker-entrypoint.sh
# can fix ownership of whatever got mounted (a named volume seeded wrong, a
# stale volume from before a directory existed in the image, a bind-mounted
# host directory owned by a different uid) on every boot. It drops to the
# unprivileged `app` user itself, via gosu, right before actually running
# node — see that script.
EXPOSE 5570

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
