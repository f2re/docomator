#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf 'Команда reset-password.sh оставлена для совместимости. Сбрасывается только 4-значный код доступа; логин не используется.\n' >&2
exec "$SCRIPT_DIR/set-password.sh" "$@"
