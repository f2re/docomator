#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
args=()
for argument in "$@"; do
  if [[ "$argument" == "--password-stdin" ]]; then
    args+=("--code-stdin")
  else
    args+=("$argument")
  fi
done
printf 'Совместимость: set-password.sh заменён на set-access-code.sh. Используйте новый путь.\n' >&2
exec "$SCRIPT_DIR/set-access-code.sh" "${args[@]}"
