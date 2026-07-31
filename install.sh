#!/usr/bin/env bash
# Single curl/wget-able entrypoint for Balanced Waypoints:
#
#   curl -fsSL https://raw.githubusercontent.com/j5guy/balancedwaypoints/master/install.sh | bash
#
# Installs whatever this host is missing (git, curl, Node.js), clones this
# repo into the final install directory, then hands off to the guided setup
# wizard (scripts/setup-wizard.js), which writes .env and brings up the
# Docker stack. Docker-only — no local systemd service mode.
#
# Run this from inside an existing checkout instead (./install.sh) and it
# skips the clone step entirely, operating in place on that checkout.
set -euo pipefail

REPO_URL="${BALANCEDWAYPOINTS_REPO_URL:-https://github.com/j5guy/balancedwaypoints.git}"
FINAL_DIR="${BALANCEDWAYPOINTS_INSTALL_DIR:-/opt/balancedwaypoints}"
REPO_REF="${BALANCEDWAYPOINTS_REPO_REF:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) FINAL_DIR="$2"; shift 2 ;;
    --dir=*) FINAL_DIR="${1#--dir=}"; shift ;;
    --ref) REPO_REF="$2"; shift 2 ;;
    --ref=*) REPO_REF="${1#--ref=}"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
IN_PLACE=0
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/scripts/setup-wizard.js" ]; then
  IN_PLACE=1
fi

have_cmd() { command -v "$1" >/dev/null 2>&1; }

ensure_curl_git() {
  if have_cmd git && have_cmd curl; then return; fi
  echo "Installing git/curl..."
  if have_cmd apt-get; then
    sudo apt-get update
    sudo apt-get install -y git curl
  elif have_cmd dnf; then
    sudo dnf install -y git curl
  elif have_cmd yum; then
    sudo yum install -y git curl
  else
    echo "Could not find apt-get/dnf/yum to install git/curl — install them manually, then re-run this command." >&2
    exit 1
  fi
}

ensure_node() {
  if have_cmd node; then return; fi
  echo "Node.js not found — installing via NodeSource (requires sudo)..."
  if have_cmd apt-get; then
    if ! have_cmd curl; then
      sudo apt-get update
      sudo apt-get install -y curl
    fi
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

if [ "$IN_PLACE" -eq 1 ]; then
  echo "== Balanced Waypoints install (existing checkout at $SCRIPT_DIR) =="
  WORK_DIR="$SCRIPT_DIR"
else
  echo "== Balanced Waypoints install =="
  ensure_curl_git
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/balancedwaypoints-install.XXXXXX")"
  if [ -n "$REPO_REF" ]; then
    git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$WORK_DIR"
  else
    git clone --depth 1 "$REPO_URL" "$WORK_DIR"
  fi

  if [ ! -d "$FINAL_DIR" ]; then
    sudo mkdir -p "$FINAL_DIR"
    sudo chown "$(id -un):$(id -gn)" "$FINAL_DIR"
  fi

  echo "== Moving checkout to $FINAL_DIR =="
  cp -a "$WORK_DIR/." "$FINAL_DIR/"
  rm -rf "$WORK_DIR"
  WORK_DIR="$FINAL_DIR"
fi

ensure_node
echo "Node: $(node --version)"

cd "$WORK_DIR"
if [ ! -d node_modules ]; then
  echo "Installing npm dependencies..."
  npm install
fi

exec node scripts/setup-wizard.js
