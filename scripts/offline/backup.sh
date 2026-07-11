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
Usage: ./backup.sh [options]

Creates a checksum-protected online backup of SQLite, immutable object storage,
and the local configuration. No network access is used.

Options:
  --install-root DIR  Installation root (default: /opt/docomator)
  --data-dir DIR      Persistent data directory (default: /var/lib/docomator)
  --config-dir DIR    Configuration directory (default: /etc/docomator)
  --output DIR        Exact backup directory
  --retention COUNT   Keep newest COUNT regular backups (default: 7)
  --prefix NAME       Backup directory prefix (default: backup)
  -h, --help          Show help
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
    *) die "Unknown option: $1" ;;
  esac
done

require_root
require_command flock

INSTALL_ROOT="$(absolute_path "$INSTALL_ROOT")"
DATA_DIR="$(absolute_path "$DATA_DIR")"
CONFIG_DIR="$(absolute_path "$CONFIG_DIR")"
NODE="$INSTALL_ROOT/current/runtime/node/bin/node"
BACKUP_CLI="$INSTALL_ROOT/current/app/scripts/runtime/backup.mjs"
[[ -x "$NODE" ]] || die "Bundled Node.js runtime not found: $NODE"
[[ -f "$BACKUP_CLI" ]] || die "Backup CLI not found: $BACKUP_CLI"
[[ -f "$DATA_DIR/docomator.db" ]] || die "Database not found: $DATA_DIR/docomator.db"

LOCK_FILE="/run/lock/docomator-backup.lock"
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || die "Another Docomator backup is running"

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

info "Creating Docomator backup"
exec "$NODE" "$BACKUP_CLI" "${ARGS[@]}"
