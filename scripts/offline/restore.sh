#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

INSTALL_ROOT="/opt/docomator"
DATA_DIR="/var/lib/docomator"
CONFIG_DIR="/etc/docomator"
BACKUP_DIR=""
NO_SYSTEMD=0
NO_START=0

usage() {
  cat <<'USAGE'
Usage: ./restore.sh --backup DIR [options]

Verifies and restores a Docomator backup. The script creates a pre-restore
backup first, stops services, restores data, runs current migrations and checks
readiness. A failed migration/readiness check restores the pre-restore backup.

Options:
  --backup DIR       Backup directory to restore (required)
  --install-root DIR Installation root (default: /opt/docomator)
  --data-dir DIR     Persistent data directory (default: /var/lib/docomator)
  --config-dir DIR   Configuration directory (default: /etc/docomator)
  --no-systemd       Skip systemd service control (test/chroot mode)
  --no-start         Do not start services after a successful restore
  -h, --help         Show help
USAGE
}

while (($# > 0)); do
  case "$1" in
    --backup) BACKUP_DIR="$2"; shift 2 ;;
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --no-systemd) NO_SYSTEMD=1; NO_START=1; shift ;;
    --no-start) NO_START=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

require_root
require_command flock
[[ -n "$BACKUP_DIR" ]] || die "--backup is required"

INSTALL_ROOT="$(absolute_path "$INSTALL_ROOT")"
DATA_DIR="$(absolute_path "$DATA_DIR")"
CONFIG_DIR="$(absolute_path "$CONFIG_DIR")"
BACKUP_DIR="$(absolute_path "$BACKUP_DIR")"
NODE="$INSTALL_ROOT/current/runtime/node/bin/node"
BACKUP_CLI="$INSTALL_ROOT/current/app/scripts/runtime/backup.mjs"
RESTORE_CLI="$INSTALL_ROOT/current/app/scripts/runtime/restore.mjs"
MIGRATE_CLI="$INSTALL_ROOT/current/app/scripts/runtime/migrate.mjs"
CONFIG_FILE="$CONFIG_DIR/docomator.env"
HEALTHCHECK="$INSTALL_ROOT/current/healthcheck.mjs"
[[ -x "$NODE" ]] || die "Bundled Node.js runtime not found: $NODE"
[[ -f "$BACKUP_CLI" && -f "$RESTORE_CLI" && -f "$MIGRATE_CLI" ]] || \
  die "Backup/restore runtime files are incomplete"

LOCK_FILE="/run/lock/docomator-maintenance.lock"
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || die "Another Docomator maintenance operation is running"

"$NODE" "$RESTORE_CLI" --backup "$BACKUP_DIR" --verify-only >/dev/null
PRE_RESTORE_DIR="$DATA_DIR/backups/pre-restore-$(date -u +'%Y%m%dT%H%M%SZ')-$$"
"$NODE" "$BACKUP_CLI" \
  --data-dir "$DATA_DIR" \
  --config-file "$CONFIG_FILE" \
  --release-version "$(read_env_value "$CONFIG_FILE" DOCOMATOR_VERSION)" \
  --output "$PRE_RESTORE_DIR" \
  --prefix pre-restore >/dev/null
info "Pre-restore backup created: $PRE_RESTORE_DIR"

if ((NO_SYSTEMD == 0)); then
  require_command systemctl
  stop_docomator_services
fi

start_services() {
  if ((NO_SYSTEMD == 1 || NO_START == 1)); then
    return 0
  fi
  local llm_enabled llm_model
  llm_enabled="$(read_env_value "$CONFIG_FILE" DOCOMATOR_LLM_ENABLED)"
  llm_model="$(read_env_value "$CONFIG_FILE" DOCOMATOR_LLM_MODEL)"
  if [[ "$llm_enabled" == "true" && -f "$llm_model" ]]; then
    systemctl start docomator-llm.service
  fi
  systemctl start docomator-api.service docomator-worker.service
}

check_readiness() {
  if ((NO_SYSTEMD == 1 || NO_START == 1)); then
    return 0
  fi
  local host port url
  host="$(read_env_value "$CONFIG_FILE" DOCOMATOR_HOST)"
  port="$(read_env_value "$CONFIG_FILE" DOCOMATOR_PORT)"
  [[ -n "$host" ]] || host="127.0.0.1"
  [[ "$host" == "0.0.0.0" || "$host" == "::" ]] && host="127.0.0.1"
  [[ -n "$port" ]] || port="8080"
  url="http://${host}:${port}/readyz"
  for _ in $(seq 1 30); do
    if "$NODE" "$HEALTHCHECK" "$url" 3000 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

apply_restore() {
  local source="$1"
  "$NODE" "$RESTORE_CLI" \
    --backup "$source" \
    --data-dir "$DATA_DIR" \
    --config-file "$CONFIG_FILE" >/dev/null
  DOCOMATOR_DATA_DIR="$DATA_DIR" "$NODE" "$MIGRATE_CLI" >/dev/null
}

if apply_restore "$BACKUP_DIR" && start_services && check_readiness; then
  info "Docomator backup restored successfully: $BACKUP_DIR"
  exit 0
fi

warn "Restore validation failed; rolling back to $PRE_RESTORE_DIR"
if ((NO_SYSTEMD == 0)); then
  stop_docomator_services
fi
if ! apply_restore "$PRE_RESTORE_DIR"; then
  die "Restore failed and automatic rollback also failed. Data is preserved in $PRE_RESTORE_DIR"
fi
start_services || true
check_readiness || true
die "Restore failed; pre-restore state was reinstated"
