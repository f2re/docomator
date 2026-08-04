#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CURRENT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
NODE="$CURRENT_ROOT/runtime/node/bin/node"
PILOT_SCRIPT="$SCRIPT_DIR/pilot-check.mjs"
CONFIG_FILE="/etc/docomator/docomator.env"
RUN_BACKUP=0

usage() {
  cat <<'USAGE'
Использование: sudo bash pilot-check.sh [параметры]

Проводит фактическую пилотную проверку установленного Docomator, подтверждает
идентичность работающего релиза и создаёт машинно-читаемый JSON и акт Markdown.

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

arguments=("$@")
for ((index = 0; index < ${#arguments[@]}; index += 1)); do
  argument="${arguments[$index]}"
  case "$argument" in
    -h|--help)
      usage
      exit 0
      ;;
    --config)
      index=$((index + 1))
      [[ $index -lt ${#arguments[@]} ]] || {
        printf 'После --config необходимо указать файл.\n' >&2
        exit 2
      }
      CONFIG_FILE="${arguments[$index]}"
      ;;
    --run-backup)
      RUN_BACKUP=1
      ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  printf 'Пилотную проверку необходимо запустить через sudo: она читает systemd, проверяет резервную копию и записывает акт в каталог данных.\n' >&2
  exit 2
fi

if [[ $RUN_BACKUP -eq 1 && -f "$CONFIG_FILE" ]]; then
  BACKUP_ENABLED="$(grep -E '^[[:space:]]*DOCOMATOR_BACKUP_ENABLED=' "$CONFIG_FILE" | tail -n 1 | cut -d= -f2- || true)"
  BACKUP_ENABLED="${BACKUP_ENABLED,,}"
  if [[ "$BACKUP_ENABLED" == "false" || "$BACKUP_ENABLED" == "0" || "$BACKUP_ENABLED" == "no" || "$BACKUP_ENABLED" == "off" ]]; then
    printf 'Нельзя выполнить --run-backup: DOCOMATOR_BACKUP_ENABLED=false. Включите резервирование и активируйте таймер.\n' >&2
    exit 2
  fi
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
