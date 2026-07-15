#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
NODE="$CURRENT_ROOT/runtime/node/bin/node"
PILOT_SCRIPT="$SCRIPT_DIR/pilot-readiness.mjs"

usage() {
  cat <<'USAGE'
Использование: sudo pilot-check.sh [параметры]

Проводит фактическую пилотную проверку установленного Docomator и создаёт
машинно-читаемый JSON и акт приёмки Markdown.

Параметры:
  --config ФАЙЛ       файл настроек Docomator
  --url АДРЕС         явный адрес API
  --output КАТАЛОГ    каталог отчётов
  --run-backup        создать и проверить новую резервную копию
  --require-network   считать сетевую папку обязательной
  --require-smtp      считать SMTP обязательным
  --json-only         вывести только JSON-результат
  -h, --help          показать справку

Коды завершения:
  0  пилотный контур готов
  1  есть предупреждения
  2  обнаружена блокирующая ошибка
USAGE
}

for argument in "$@"; do
  case "$argument" in
    -h|--help)
      usage
      exit 0
      ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  printf 'Пилотную проверку необходимо запустить через sudo: она читает systemd, проверяет резервную копию и записывает акт в каталог данных.\n' >&2
  exit 2
fi

if [[ ! -x "$NODE" ]]; then
  if command -v node >/dev/null 2>&1; then
    NODE="$(command -v node)"
  else
    printf 'Не найден встроенный Node.js: %s\n' "$NODE" >&2
    exit 2
  fi
fi

if [[ ! -f "$PILOT_SCRIPT" ]]; then
  printf 'Не найден сценарий пилотной проверки: %s\n' "$PILOT_SCRIPT" >&2
  exit 2
fi

exec "$NODE" "$PILOT_SCRIPT" "$@"
