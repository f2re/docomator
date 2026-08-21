#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf 'Совместимость: reset-password.sh заменён на reset-access-code.sh. Используйте новый путь.\n' >&2
exec "$SCRIPT_DIR/reset-access-code.sh" "$@"
