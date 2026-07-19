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
require_command dpkg
require_command dpkg-deb
require_command sha256sum
[[ -f "$PACKAGE_LIST" ]] || die "Package list not found: $PACKAGE_LIST"
[[ -f /etc/os-release ]] || die "Не найден /etc/os-release"

mapfile -t packages < <(
  sed -E 's/[[:space:]]*#.*$//' "$PACKAGE_LIST" \
    | awk '{$1=$1} NF {print}'
)
((${#packages[@]} > 0)) || die "Package list is empty"
for package in "${packages[@]}"; do
  [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || \
    die "Некорректная строка package list: $package"
done
if [[ "$(printf '%s\n' "${packages[@]}" | LC_ALL=C sort | uniq -d | head -n 1)" != "" ]]; then
  die "Package list содержит повторяющееся имя"
fi

mkdir -p "$OUTPUT_DIR/partial"
OUTPUT_DIR="$(absolute_path "$OUTPUT_DIR")"
rm -f "$OUTPUT_DIR"/*.deb "$OUTPUT_DIR/manifest.sha256" \
  "$OUTPUT_DIR/packages.tsv" "$OUTPUT_DIR/source-os.env"

if ((RUN_UPDATE == 1)); then
  apt-get update
fi

info "Downloading packages for: ${packages[*]}"
apt-get \
  -o "Dir::Cache::archives=$OUTPUT_DIR" \
  -o APT::Keep-Downloaded-Packages=true \
  --download-only --reinstall --yes install -- "${packages[@]}"

mapfile -d '' debs < <(find "$OUTPUT_DIR" -maxdepth 1 -type f -name '*.deb' -print0 | sort -z)
((${#debs[@]} > 0)) || die "apt-get did not download any .deb files"

OS_ID="$(sed -n -E 's/^ID="?([^"[:space:]]+)"?$/\1/p' /etc/os-release | head -n 1)"
OS_VERSION_ID="$(sed -n -E 's/^VERSION_ID="?([^"[:space:]]+)"?$/\1/p' /etc/os-release | head -n 1)"
DEB_ARCHITECTURE="$(dpkg --print-architecture)"
[[ "$OS_ID" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "Некорректный ID в /etc/os-release"
[[ "$OS_VERSION_ID" =~ ^[A-Za-z0-9][A-Za-z0-9.+:~_-]*$ ]] || \
  die "Некорректный VERSION_ID в /etc/os-release"
[[ "$DEB_ARCHITECTURE" =~ ^[a-z0-9][a-z0-9-]*$ ]] || \
  die "Некорректная Debian-архитектура: $DEB_ARCHITECTURE"

(
  cd "$OUTPUT_DIR"
  find . -maxdepth 1 -type f -name '*.deb' -print0 \
    | sort -z \
    | xargs -0 sha256sum > manifest.sha256
)

printf '%s\n' \
  "OS_ID=$OS_ID" \
  "OS_VERSION_ID=$OS_VERSION_ID" \
  "DEB_ARCHITECTURE=$DEB_ARCHITECTURE" \
  > "$OUTPUT_DIR/source-os.env"

printf 'sha256\tpackage\tversion\tarchitecture\tfilename\n' \
  > "$OUTPUT_DIR/packages.tsv"
for deb in "${debs[@]}"; do
  filename="$(basename "$deb")"
  package="$(dpkg-deb -f "$deb" Package)"
  version="$(dpkg-deb -f "$deb" Version)"
  architecture="$(dpkg-deb -f "$deb" Architecture)"
  [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || \
    die "Некорректное имя Debian-пакета: $filename"
  [[ -n "$version" && "$version" != *$'\t'* && "$version" != *$'\n'* ]] || \
    die "Некорректная версия Debian-пакета: $filename"
  [[ "$architecture" == "all" || "$architecture" == "$DEB_ARCHITECTURE" ]] || \
    die "Пакет $filename предназначен для другой архитектуры: $architecture"
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$(sha256_of "$deb")" "$package" "$version" "$architecture" "$filename" \
    >> "$OUTPUT_DIR/packages.tsv"
done
LC_ALL=C sort -t $'\t' -k5,5 -o "$OUTPUT_DIR/packages.tsv" \
  "$OUTPUT_DIR/packages.tsv"
# Возвращаем заголовок после сортировки всего файла.
sed -i '/^sha256\tpackage\tversion\tarchitecture\tfilename$/d' \
  "$OUTPUT_DIR/packages.tsv"
sed -i '1i sha256\tpackage\tversion\tarchitecture\tfilename' \
  "$OUTPUT_DIR/packages.tsv"

verify_os_package_set "$OUTPUT_DIR" 0

info "Collected ${#debs[@]} packages in $OUTPUT_DIR"
warn "Verify dependency completeness on a clean offline test VM before release."
