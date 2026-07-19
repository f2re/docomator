#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
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
require_trusted_bundle "$SCRIPT_DIR"
[[ "$BUNDLE_ROOT" == "$SCRIPT_DIR" ]] || require_trusted_bundle "$BUNDLE_ROOT"
"$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"

LOCK_FILE="/run/lock/docomator-update.lock"
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || die "Another Docomator installation or update is running"

exec "$SCRIPT_DIR/install.sh" --upgrade "$@"
