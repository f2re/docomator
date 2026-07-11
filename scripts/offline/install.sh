#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

BUNDLE_ROOT="$SCRIPT_DIR"
INSTALL_ROOT="/opt/docomator"
DATA_DIR="/var/lib/docomator"
CONFIG_DIR="/etc/docomator"
DOCOMATOR_USER="docomator"
DOCOMATOR_GROUP="docomator"
NO_START=0
INSTALL_OS_PACKAGES=0
UPGRADE=0
INSTALL_SYSTEMD=1

usage() {
  cat <<'USAGE'
Usage: ./install.sh [options]

Installs a verified Docomator offline bundle. This script never accesses the
network. Run update.sh for an existing installation.

Options:
  --bundle-root DIR        Extracted bundle directory (default: script directory)
  --install-root DIR       Release root (default: /opt/docomator)
  --data-dir DIR           Persistent data directory (default: /var/lib/docomator)
  --config-dir DIR         Configuration directory (default: /etc/docomator)
  --user NAME              Service user (default: docomator)
  --group NAME             Service group (default: docomator)
  --install-os-packages    Install bundled .deb packages before the application
  --no-start               Install units and migrate, but do not enable/start services
  --no-systemd             Skip unit installation and service control (test/chroot mode)
  --upgrade                Internal flag used by update.sh
  -h, --help               Show this help
USAGE
}

while (($# > 0)); do
  case "$1" in
    --bundle-root) BUNDLE_ROOT="$2"; shift 2 ;;
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --user) DOCOMATOR_USER="$2"; shift 2 ;;
    --group) DOCOMATOR_GROUP="$2"; shift 2 ;;
    --install-os-packages) INSTALL_OS_PACKAGES=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --no-systemd) INSTALL_SYSTEMD=0; NO_START=1; shift ;;
    --upgrade) UPGRADE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

require_root
require_command sha256sum
require_command sed
require_command cp
require_command mv
require_command ln
require_command cmp

BUNDLE_ROOT="$(absolute_path "$BUNDLE_ROOT")"
INSTALL_ROOT="$(mkdir -p "$INSTALL_ROOT" && absolute_path "$INSTALL_ROOT")"
mkdir -p "$DATA_DIR" "$CONFIG_DIR"
DATA_DIR="$(absolute_path "$DATA_DIR")"
CONFIG_DIR="$(absolute_path "$CONFIG_DIR")"

"$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"
VERSION="$(<"$BUNDLE_ROOT/VERSION")"
RELEASES_DIR="$INSTALL_ROOT/releases"
RELEASE_DIR="$RELEASES_DIR/$VERSION"
CURRENT_LINK="$INSTALL_ROOT/current"
CONFIG_FILE="$CONFIG_DIR/docomator.env"
DATABASE_PATH="$DATA_DIR/docomator.db"

if ((UPGRADE == 1)) && [[ ! -L "$CURRENT_LINK" ]]; then
  die "No existing Docomator installation was found at $CURRENT_LINK"
fi

if ((INSTALL_OS_PACKAGES == 1)); then
  mapfile -d '' debs < <(find "$BUNDLE_ROOT/payload/os-packages" -maxdepth 1 -type f -name '*.deb' -print0 | sort -z)
  ((${#debs[@]} > 0)) || die "No .deb packages are included in this bundle"
  require_command dpkg
  info "Installing ${#debs[@]} bundled OS packages"
  if ! dpkg -i "${debs[@]}"; then
    require_command apt-get
    APT_CACHE="$(mktemp -d "${TMPDIR:-/tmp}/docomator-apt.XXXXXX")"
    trap 'rm -rf "${APT_CACHE:-}"' EXIT
    mkdir -p "$APT_CACHE/partial"
    cp "${debs[@]}" "$APT_CACHE/"
    apt-get -o "Dir::Cache::archives=$APT_CACHE" --no-download --fix-broken install -y
  fi
fi

if ! getent group "$DOCOMATOR_GROUP" >/dev/null 2>&1; then
  groupadd --system "$DOCOMATOR_GROUP"
fi

if ! id "$DOCOMATOR_USER" >/dev/null 2>&1; then
  NOLOGIN_SHELL="/usr/sbin/nologin"
  [[ -x "$NOLOGIN_SHELL" ]] || NOLOGIN_SHELL="/bin/false"
  useradd --system --gid "$DOCOMATOR_GROUP" --home-dir "$DATA_DIR" \
    --shell "$NOLOGIN_SHELL" "$DOCOMATOR_USER"
fi

mkdir -p \
  "$RELEASES_DIR" \
  "$DATA_DIR/objects" \
  "$DATA_DIR/models" \
  "$DATA_DIR/previews" \
  "$DATA_DIR/backups" \
  "$DATA_DIR/tmp" \
  "$DATA_DIR/logs"
chown -R "$DOCOMATOR_USER:$DOCOMATOR_GROUP" "$DATA_DIR"
chmod 0750 "$DATA_DIR" "$DATA_DIR"/{objects,models,previews,backups,tmp,logs}

NEW_CONFIG=0
if [[ ! -f "$CONFIG_FILE" ]]; then
  cp "$BUNDLE_ROOT/payload/config/docomator.env.example" "$CONFIG_FILE"
  chmod 0640 "$CONFIG_FILE"
