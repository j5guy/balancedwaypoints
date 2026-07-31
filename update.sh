#!/usr/bin/env bash
# Pulls the latest source, rebuilds, and restarts the Docker stack in place:
#
#   cd /opt/balancedwaypoints && ./update.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f .env ]; then
  echo "No .env in $(pwd) — this doesn't look like a Balanced Waypoints install directory. Aborting." >&2
  exit 1
fi

if [ -d .git ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "Local changes detected — commit or stash them (git status) before updating." >&2
    exit 1
  fi
  if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
    git fetch --unshallow origin
  fi
  git fetch --tags origin
  LATEST_TAG="$(git tag -l 'v*' --sort=-v:refname | head -1)"
  if [ -n "$LATEST_TAG" ]; then
    echo "Checking out $LATEST_TAG"
    git checkout "$LATEST_TAG"
  else
    echo "No release tags found — pulling latest on the current branch instead."
    git pull
  fi
else
  echo "Not a git checkout — pull whatever changes yourself, then re-run this script."
fi

# mongoHost=mongo (the default) means the bundled internal container is in
# use; anything else means an external MongoDB, so the mongo overlay/
# container should be left alone.
COMPOSE_ARGS=(-f docker-compose.yml -f docker-compose.nginx.yml)
if grep -qE '^mongoHost=mongo\s*$' .env; then
  COMPOSE_ARGS+=(-f docker-compose.mongo.yml)
fi

echo "== Rebuilding and restarting =="
docker compose "${COMPOSE_ARGS[@]}" up -d --build

echo
echo "Update complete. Check status with: docker compose ${COMPOSE_ARGS[*]} ps"
