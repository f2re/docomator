#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cat >&2 <<'NOTICE'
Сброс кода доступа создаёт новый четырёхзначный код без запроса старого.
Все ранее открытые браузерные сессии будут закрыты. Данные и документы не меняются.
NOTICE
exec "$SCRIPT_DIR/set-access-code.sh" "$@"
