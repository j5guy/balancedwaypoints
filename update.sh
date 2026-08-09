#!/usr/bin/env bash
# Unified update entrypoint — the same command regardless of footprint (full
# checkout, or Docker-only minimal footprint — see scripts/lib/footprint.js):
#
#   cd /opt/balancedwaypoints && ./update.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
FINAL_DIR="$(pwd)"

if [ ! -f .env ]; then
  echo "No .env in $FINAL_DIR — this doesn't look like a Balanced Waypoints install directory. Aborting." >&2
  exit 1
fi

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# .deploy-state.json is our own flat, pretty-printed JSON.stringify(obj,
# null, 2) output (see scripts/lib/bringUp.js's writeDeployState) — this
# simple per-line sed extraction is reliable against it specifically,
# without needing Node.js on hand yet to parse it (a minimal-footprint host
# may not have Node installed at all until ensure_node below runs).
json_field() {
  sed -n -E "s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"?([^\",}]*)\"?,?[[:space:]]*\$/\1/p" "$2" | head -1
}

FOOTPRINT=""
if [ -f .deploy-state.json ]; then
  FOOTPRINT="$(json_field footprint .deploy-state.json)"
fi
# Installs from before .deploy-state.json existed are exactly what "full"
# always meant (the only footprint that existed then) — treat that as the
# default instead of erroring; scripts/update.js writes the file for real
# once this run completes, so future updates read it directly.
FOOTPRINT="${FOOTPRINT:-full}"

REPO_URL="${BALANCEDWAYPOINTS_REPO_URL:-https://github.com/j5guy/balancedwaypoints.git}"
REPO_REF="${BALANCEDWAYPOINTS_REPO_REF:-master}"

# Same NodeSource-based install install.sh uses — needed here too since a
# minimal-footprint host may never have had Node.js on it at all (the
# trimmed-down install directory has no node_modules/package.json of its
# own to hint otherwise).
ensure_node() {
  if have_cmd node; then return; fi
  echo "Node.js not found — installing via NodeSource (requires sudo)..."
  if have_cmd apt-get; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif have_cmd dnf; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
    sudo dnf install -y nodejs
  else
    echo "Unsupported package manager — install Node.js manually: https://nodejs.org/" >&2
    exit 1
  fi
}

if [ "$FOOTPRINT" = "minimal" ]; then
  echo "== Updating minimal-footprint install at $FINAL_DIR =="
  have_cmd git || { echo "git not found — install it, then re-run this command." >&2; exit 1; }
  ensure_node
  SCRATCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/balancedwaypoints-update.XXXXXX")"
  if [ -n "${BALANCEDWAYPOINTS_REPO_REF:-}" ]; then
    echo "Cloning $REPO_URL (ref: $BALANCEDWAYPOINTS_REPO_REF) into $SCRATCH_DIR ..."
    git clone --depth 1 --branch "$BALANCEDWAYPOINTS_REPO_REF" "$REPO_URL" "$SCRATCH_DIR"
  else
    echo "Cloning the latest release into $SCRATCH_DIR ..."
    git clone --depth 1 "$REPO_URL" "$SCRATCH_DIR"
  fi
  ( cd "$SCRATCH_DIR" && npm install )
  # Resolves the image (rebuild), writes the refreshed compose file, brings
  # the stack up from $FINAL_DIR, and deletes $SCRATCH_DIR itself once
  # done — see scripts/lib/footprint.js's trimToMinimalFootprint.
  node "$SCRATCH_DIR/scripts/update.js" --mode minimal --final-dir "$FINAL_DIR"
else
  echo "== Updating full checkout at $FINAL_DIR =="
  if [ -d .git ]; then
    if [ -n "$(git status --porcelain)" ]; then
      echo "Local changes detected in $FINAL_DIR — commit or stash them (git status) before updating, so an update can't silently overwrite them." >&2
      exit 1
    fi
    # A shallow clone (install.sh always uses --depth 1) can't check out a
    # tag outside its shallow history — unshallow first so any release tag
    # is reachable, not just whatever was at HEAD when first installed.
    if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
      git fetch --unshallow origin
    fi
    git fetch --tags origin
    LATEST_TAG="$(git tag -l 'v*' --sort=-v:refname | head -1)"
    if [ -n "$LATEST_TAG" ]; then
      echo "Checking out $LATEST_TAG"
      git checkout "$LATEST_TAG"
    else
      echo "No release tags found — updating to the latest $REPO_REF instead."
      git checkout "$REPO_REF"
      git pull origin "$REPO_REF"
    fi
  else
    echo "Not a git checkout — pull whatever changes yourself, then re-run this script."
  fi
  ensure_node
  npm install
  node scripts/update.js --mode full
fi

echo
echo "Update complete."
