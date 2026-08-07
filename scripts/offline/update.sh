#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
require_command flock

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
"$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"

LOCK_FILE="/run/lock/docomator-update.lock"
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || die "Уже выполняется другая установка или обновление Docomator"

exec "$SCRIPT_DIR/install.sh" --upgrade "$@"
