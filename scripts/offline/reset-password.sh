#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cat >&2 <<'NOTICE'
Сброс общего пароля Оформлятор создаёт новый пароль без запроса старого.
Все ранее выданные браузерные сессии будут завершены. Данные и документы не меняются.
NOTICE
exec "$SCRIPT_DIR/set-password.sh" "$@"
