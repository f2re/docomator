#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/offline/smoke-test.sh EXTRACTED_BUNDLE_DIR

Performs a network-free install and update smoke test in temporary directories.
The test skips systemd and uses the existing nobody account. It must run as
root because the production installer enforces privileged ownership changes.
USAGE
}

if (($# != 1)); then
  usage >&2
  exit 2
fi

require_root
require_command curl
require_command getent

BUNDLE_ROOT="$(absolute_path "$1")"
[[ -x "$BUNDLE_ROOT/install.sh" ]] || die "install.sh is missing in $BUNDLE_ROOT"
[[ -x "$BUNDLE_ROOT/update.sh" ]] || die "update.sh is missing in $BUNDLE_ROOT"

if ! id nobody >/dev/null 2>&1; then
  die "The smoke test requires the standard nobody account"
fi
TEST_GROUP="$(id -gn nobody)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/docomator-install-smoke.XXXXXX")"
INSTALL_ROOT="$TEST_ROOT/opt/docomator"
DATA_DIR="$TEST_ROOT/var/lib/docomator"
CONFIG_DIR="$TEST_ROOT/etc/docomator"
API_PID=""

cleanup() {
  if [[ -n "$API_PID" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

COMMON_ARGS=(
  --bundle-root "$BUNDLE_ROOT"
  --install-root "$INSTALL_ROOT"
  --data-dir "$DATA_DIR"
  --config-dir "$CONFIG_DIR"
  --user nobody
  --group "$TEST_GROUP"
  --no-systemd
)

info "Running first offline installation"
"$BUNDLE_ROOT/install.sh" "${COMMON_ARGS[@]}"

[[ -L "$INSTALL_ROOT/current" ]] || die "current symlink was not created"
[[ -f "$DATA_DIR/docomator.db" ]] || die "database was not created"
[[ -f "$CONFIG_DIR/docomator.env" ]] || die "configuration was not created"

set -a
# The generated file contains simple KEY=VALUE assignments only.
# shellcheck disable=SC1090
source "$CONFIG_DIR/docomator.env"
set +a
export DOCOMATOR_HOST=127.0.0.1
export DOCOMATOR_PORT=18081

info "Starting bundled API for readiness verification"
"$INSTALL_ROOT/current/runtime/node/bin/node" \
  "$INSTALL_ROOT/current/app/apps/api/dist/server.js" \
  >"$TEST_ROOT/api.log" 2>&1 &
API_PID=$!

READY=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error \
    "http://127.0.0.1:${DOCOMATOR_PORT}/readyz" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.2
done
((READY == 1)) || {
  cat "$TEST_ROOT/api.log" >&2 || true
  die "Bundled API did not become ready"
}

kill "$API_PID"
wait "$API_PID" 2>/dev/null || true
API_PID=""

info "Running offline update path with the same immutable release"
"$BUNDLE_ROOT/update.sh" "${COMMON_ARGS[@]}"

BACKUP_COUNT="$(find "$DATA_DIR/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)"
((BACKUP_COUNT >= 1)) || die "Update did not create a pre-update backup"

info "Offline install/update smoke test passed"
