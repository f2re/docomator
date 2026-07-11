#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

PACKAGE_LIST="$ROOT_DIR/config/os-packages.txt"
OUTPUT_DIR="$ROOT_DIR/offline-bundles/os-packages"
RUN_UPDATE=0

usage() {
  cat <<'USAGE'
Usage: sudo scripts/offline/collect-os-packages.sh [options]

Downloads Debian packages into a portable directory. Run this on a clean
reference VM with exactly the same Debian/Astra release and architecture as the
offline target. No packages are installed by this script.

Options:
  --package-list FILE    Package list (default: config/os-packages.txt)
  --output DIR           Destination directory
  --apt-update           Run apt-get update before downloading
  -h, --help             Show this help
USAGE
}

while (($# > 0)); do
  case "$1" in
    --package-list) PACKAGE_LIST="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --apt-update) RUN_UPDATE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

require_root
require_command apt-get
require_command sha256sum
[[ -f "$PACKAGE_LIST" ]] || die "Package list not found: $PACKAGE_LIST"

mapfile -t packages < <(sed -E 's/[[:space:]]*#.*$//' "$PACKAGE_LIST" | awk 'NF {print $1}')
((${#packages[@]} > 0)) || die "Package list is empty"

mkdir -p "$OUTPUT_DIR/partial"
OUTPUT_DIR="$(absolute_path "$OUTPUT_DIR")"
rm -f "$OUTPUT_DIR"/*.deb "$OUTPUT_DIR/manifest.sha256"

if ((RUN_UPDATE == 1)); then
  apt-get update
fi

info "Downloading packages for: ${packages[*]}"
apt-get \
  -o "Dir::Cache::archives=$OUTPUT_DIR" \
  -o APT::Keep-Downloaded-Packages=true \
  --download-only --reinstall --yes install "${packages[@]}"

mapfile -d '' debs < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name '*.deb' -print0 | sort -z)
((${#debs[@]} > 0)) || die "apt-get did not download any .deb files"

(
  cd "$OUTPUT_DIR"
  find . -maxdepth 1 -type f -name '*.deb' -print0 \
    | sort -z \
    | xargs -0 sha256sum > manifest.sha256
)

info "Collected ${#debs[@]} packages in $OUTPUT_DIR"
warn "Verify dependency completeness on a clean offline test VM before release."
