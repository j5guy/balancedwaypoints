#!/usr/bin/env bash
# Destroys a Balanced Waypoints deployment entirely — curlable, like install.sh:
#
#   curl -fsSL https://raw.githubusercontent.com/j5guy/balancedwaypoints/master/uninstall.sh | bash -s -- --yes
#
# DESTRUCTIVE. Removes the Docker stack (containers, named volumes — every
# account's data if MongoDB is internal — images, network) and the install
# directory itself. Run it from inside a checkout instead (./uninstall.sh)
# and it targets that checkout's own directory by default.
set -euo pipefail

FINAL_DIR="${BALANCEDWAYPOINTS_INSTALL_DIR:-/opt/balancedwaypoints}"
SKIP_CONFIRM=0

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/scripts/setup-wizard.js" ]; then
  FINAL_DIR="$SCRIPT_DIR"
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) FINAL_DIR="$2"; shift 2 ;;
    --dir=*) FINAL_DIR="${1#--dir=}"; shift ;;
    --yes) SKIP_CONFIRM=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

have_cmd() { command -v "$1" >/dev/null 2>&1; }

if [ -t 1 ]; then
  RED_BOLD="$(printf '\033[1;31m')"; RED="$(printf '\033[0;31m')"; RESET="$(printf '\033[0m')"
else
  RED_BOLD=""; RED=""; RESET=""
fi

MONGO_MODE="internal"
if [ -f "$FINAL_DIR/.env" ] && ! grep -qE '^mongoHost=mongo\s*$' "$FINAL_DIR/.env"; then
  MONGO_MODE="external"
fi

echo
echo "${RED_BOLD}###############################################################${RESET}"
echo "${RED_BOLD}#                        DANGER — DESTRUCTIVE                 #${RESET}"
echo "${RED_BOLD}###############################################################${RESET}"
echo
echo "${RED}This will PERMANENTLY DELETE the Balanced Waypoints deployment at $FINAL_DIR.${RESET}"
echo "${RED}This CANNOT be undone.${RESET}"
echo
if [ "$MONGO_MODE" = "internal" ]; then
  echo "${RED_BOLD}  !! THE DATABASE WILL BE DESTROYED — every account, transaction, budget !!${RESET}"
  echo "${RED}     This deployment uses the bundled MongoDB container. Its data volume${RESET}"
  echo "${RED}     will be deleted along with everything else. Back it up first if needed${RESET}"
  echo "${RED}     (a mongodump of the mongo-data volume).${RESET}"
else
  echo "  Database: this deployment is configured for an EXTERNAL MongoDB, so that"
  echo "  database itself will NOT be touched — only this app's own files and containers."
fi
echo
echo "Also deleted:"
echo "  - all Docker containers, volumes, images, and networks for this deployment"
echo "  - $FINAL_DIR itself, entirely (.env, certs/, the source checkout — everything in it)"
echo
if [ "$SKIP_CONFIRM" -ne 1 ]; then
  read -r -p "$(printf '%bType the full word '\''yes'\'' to confirm: %b' "$RED_BOLD" "$RESET")" ans
  if [ "$ans" != "yes" ]; then
    echo "Aborted — nothing was deleted."
    exit 1
  fi
else
  echo "--yes passed: skipping the interactive confirmation above."
fi

HAVE_DOCKER=1
if ! have_cmd docker || ! docker compose version &>/dev/null; then
  HAVE_DOCKER=0
  echo "docker / docker compose not found — skipping container/volume/image/network teardown."
fi

if [ "$HAVE_DOCKER" -eq 1 ] && [ -d "$FINAL_DIR" ]; then
  COMPOSE_ARGS=()
  for f in docker-compose.yml docker-compose.mongo.yml docker-compose.nginx.yml docker-compose.pull.yml; do
    [ -f "$FINAL_DIR/$f" ] && COMPOSE_ARGS+=(-f "$f")
  done
  if [ ${#COMPOSE_ARGS[@]} -gt 0 ]; then
    echo "== Tearing down the Compose stack at $FINAL_DIR =="
    ( cd "$FINAL_DIR"; [ -f .env ] || touch .env; docker compose "${COMPOSE_ARGS[@]}" down -v --remove-orphans ) || true
  fi
fi

if [ "$HAVE_DOCKER" -eq 1 ]; then
  echo "== Removing any leftover containers/volumes/images/networks by name =="
  docker ps -a --filter "name=balancedwaypoints" -q | xargs -r docker rm -f
  docker volume ls --filter "name=balancedwaypoints" -q | xargs -r docker volume rm
  for vol in mongo-data logs-data; do
    for full in "$vol" "balancedwaypoints_${vol}" "balancedwaypoints-${vol}"; do
      docker volume inspect "$full" &>/dev/null && docker volume rm "$full"
    done
  done
  docker images --filter "reference=*balancedwaypoints*" -q | sort -u | xargs -r docker rmi -f
  docker network ls --filter "name=balancedwaypoints" -q | xargs -r docker network rm
fi

echo "== Removing install directory $FINAL_DIR =="
rm -rf "$FINAL_DIR"

echo "== Removing any stray install scratch directories =="
rm -rf "${TMPDIR:-/tmp}"/balancedwaypoints-install.* 2>/dev/null || true

echo
echo "Done."
