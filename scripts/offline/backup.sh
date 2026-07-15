#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

INSTALL_ROOT="/opt/docomator"
DATA_DIR="/var/lib/docomator"
CONFIG_DIR="/etc/docomator"
OUTPUT_DIR=""
RETENTION=7
PREFIX="backup"

usage() {
  cat <<'USAGE'
Использование: ./backup.sh [параметры]

Создаёт защищённую контрольными суммами копию SQLite, неизменяемого хранилища
объектов и локальной конфигурации. Доступ к сети не требуется.

Параметры:
  --install-root DIR  корень установки (по умолчанию /opt/docomator)
  --data-dir DIR      каталог постоянных данных (по умолчанию /var/lib/docomator)
  --config-dir DIR    каталог настроек (по умолчанию /etc/docomator)
  --output DIR        точный каталог новой копии
  --retention COUNT   хранить последние COUNT обычных копий (по умолчанию 7)
  --prefix NAME       префикс каталога копии (по умолчанию backup)
  -h, --help          показать эту справку
USAGE
}

while (($# > 0)); do
  case "$1" in
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --retention) RETENTION="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

require_root
require_command stat

INSTALL_ROOT="$(absolute_path "$INSTALL_ROOT")"
DATA_DIR="$(absolute_path "$DATA_DIR")"
CONFIG_DIR="$(absolute_path "$CONFIG_DIR")"
NODE="$INSTALL_ROOT/current/runtime/node/bin/node"
BACKUP_CLI="$INSTALL_ROOT/current/app/scripts/runtime/backup.mjs"
[[ -x "$NODE" ]] || die "Не найден встроенный Node.js: $NODE"
[[ -f "$BACKUP_CLI" ]] || die "Не найден сценарий резервирования: $BACKUP_CLI"
[[ -f "$DATA_DIR/docomator.db" ]] || die "Не найдена база данных: $DATA_DIR/docomator.db"

LOCK_DIR="$DATA_DIR/.backup.lock"
OWNER_FILE="$LOCK_DIR/owner.json"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  OWNER_PID="$(sed -n -E 's/.*"pid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$OWNER_FILE" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$OWNER_PID" ]] && kill -0 "$OWNER_PID" 2>/dev/null; then
    die "Уже выполняется другое резервное копирование, процесс $OWNER_PID"
  fi
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" || die "Не удалось установить блокировку резервирования"
fi
chmod 0700 "$LOCK_DIR"
printf '{"pid":%s,"startedAt":"%s"}\n' "$$" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" > "$OWNER_FILE"
chmod 0600 "$OWNER_FILE"
DATA_OWNER="$(stat -c '%u:%g' "$DATA_DIR")"
chown "$DATA_OWNER" "$LOCK_DIR" "$OWNER_FILE"
trap 'rm -rf "$LOCK_DIR"' EXIT

ARGS=(
  --data-dir "$DATA_DIR"
  --config-file "$CONFIG_DIR/docomator.env"
  --release-version "$(read_env_value "$CONFIG_DIR/docomator.env" DOCOMATOR_VERSION)"
  --retention "$RETENTION"
  --prefix "$PREFIX"
)
if [[ -n "$OUTPUT_DIR" ]]; then
  ARGS+=(--output "$OUTPUT_DIR")
fi

info "Создаём резервную копию Docomator"
"$NODE" "$BACKUP_CLI" "${ARGS[@]}"
info "Резервная копия создана и проверена"
