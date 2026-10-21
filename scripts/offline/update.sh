#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_operator_owned_bundle() {
  local root="$1"
  root="$(absolute_path "$root")"
  [[ -d "$root" ]] || die "Каталог автономного комплекта не найден: $root"
}

INSTALL_SYSTEMD=1
for arg in "$@"; do
  if [[ "$arg" == "--no-systemd" ]]; then
    INSTALL_SYSTEMD=0
    break
  fi
done
if ((INSTALL_SYSTEMD == 1)); then
  require_root
fi
require_command flock
require_command stat

BUNDLE_ROOT="$SCRIPT_DIR"
arguments=("$@")
for ((index = 0; index < ${#arguments[@]}; index += 1)); do
  if [[ "${arguments[$index]}" == "--bundle-root" ]]; then
    ((index + 1 < ${#arguments[@]})) || die "После --bundle-root требуется каталог"
    BUNDLE_ROOT="${arguments[$((index + 1))]}"
    break
  fi
done
BUNDLE_ROOT="$(absolute_path "$BUNDLE_ROOT")"
[[ -d "$BUNDLE_ROOT" ]] || die "Каталог автономного комплекта не найден: $BUNDLE_ROOT"
"$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"

LOCK_FILE="/run/lock/docomator-update.lock"
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  LOCK_FILE="/tmp/docomator-update.lock"
fi
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || die "Another Оформлятор installation or update is running"

exec "$SCRIPT_DIR/install.sh" --upgrade "$@"
