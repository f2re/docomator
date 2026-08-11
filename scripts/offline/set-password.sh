#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="/etc/docomator/docomator.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ${1:-} == "--config" ]]; then
  CONFIG_FILE="$2"
  shift 2
fi
(($# == 0)) || { printf 'Использование: set-password.sh [--config ФАЙЛ]\n' >&2; exit 2; }
[[ -t 0 ]] || { printf 'Пароль задаётся интерактивно из терминала.\n' >&2; exit 2; }

read_value() {
  local key="$1"
  [[ -f "$CONFIG_FILE" ]] || return 0
  grep -E "^[[:space:]]*${key}=" "$CONFIG_FILE" | tail -n 1 | cut -d= -f2- || true
}

HOST="$(read_value DOCOMATOR_HOST)"
PORT="$(read_value DOCOMATOR_PORT)"
[[ -n "$HOST" ]] || HOST="127.0.0.1"
[[ -n "$PORT" ]] || PORT="8080"
case "$HOST" in 0.0.0.0|::) HOST="127.0.0.1" ;; esac
URL="http://${HOST}:${PORT}"

NODE=""
HELPER=""
for candidate in \
  /opt/docomator/current/runtime/node/bin/node \
  "$SCRIPT_DIR/payload/runtime/node/bin/node"; do
  [[ -x "$candidate" ]] && NODE="$candidate" && break
done
for candidate in \
  /opt/docomator/current/set-password.mjs \
  "$SCRIPT_DIR/set-password.mjs"; do
  [[ -f "$candidate" ]] && HELPER="$candidate" && break
done
[[ -n "$NODE" && -n "$HELPER" ]] || { printf 'Не найден локальный помощник настройки пароля.\n' >&2; exit 1; }

read -r -s -p 'Новый общий пароль (не менее 12 символов): ' PASSWORD
printf '\n'
read -r -s -p 'Повторите пароль: ' CONFIRMATION
printf '\n'
if [[ "$PASSWORD" != "$CONFIRMATION" ]]; then
  unset PASSWORD CONFIRMATION
  printf 'Пароли не совпадают.\n' >&2
  exit 2
fi
printf '%s\n%s\n' "$PASSWORD" "$CONFIRMATION" | "$NODE" "$HELPER" --url "$URL"
unset PASSWORD CONFIRMATION
