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
Использование: sudo scripts/offline/collect-os-packages.sh [параметры]

Скачивает полный транзитивный набор Debian-пакетов для автономной установки.
Сценарий необходимо запускать на эталонной Debian/Astra Linux той же версии и
архитектуры, что и целевой сервер. Пакеты на эталонную машину не устанавливаются.

Параметры:
  --package-list ФАЙЛ   исходный список пакетов (по умолчанию config/os-packages.txt)
  --output КАТАЛОГ     каталог результата
  --apt-update         выполнить apt-get update перед скачиванием
  -h, --help           показать справку
USAGE
}

need_value() {
  local option="$1"
  local count="$2"
  ((count >= 2)) || die "После $option необходимо указать значение."
}

while (($# > 0)); do
  case "$1" in
    --package-list)
      need_value "$1" "$#"
      PACKAGE_LIST="$2"
      shift 2
      ;;
    --output)
      need_value "$1" "$#"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --apt-update)
      RUN_UPDATE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Неизвестный параметр: $1"
      ;;
  esac
done

require_root
require_command apt-get
require_command awk
require_command dpkg
require_command dpkg-deb
require_command find
require_command sha256sum
require_command sort
require_command xargs
[[ -f "$PACKAGE_LIST" ]] || die "Не найден список пакетов: $PACKAGE_LIST"
[[ -f /etc/os-release ]] || die "Не найден /etc/os-release"

PACKAGE_LIST="$(absolute_path "$PACKAGE_LIST")"
mapfile -t packages < <(
  sed -E 's/[[:space:]]*#.*$//' "$PACKAGE_LIST" \
    | awk '{$1=$1} NF {print}'
)
((${#packages[@]} > 0)) || die "Список пакетов пуст."
for package in "${packages[@]}"; do
  [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || \
    die "Некорректное имя пакета в списке: $package"
done
if [[ "$(printf '%s\n' "${packages[@]}" | LC_ALL=C sort | uniq -d | head -n 1)" != "" ]]; then
  die "Список пакетов содержит повторяющееся имя."
fi

read_os_release_value() {
  local key="$1"
  local value
  value="$(grep -E "^[[:space:]]*${key}=" /etc/os-release | head -n 1 | cut -d= -f2- || true)"
  if [[ ${#value} -ge 2 && ("$value" == \"*\" || "$value" == \'*\') ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

OS_ID="$(read_os_release_value ID)"
OS_VERSION_ID="$(read_os_release_value VERSION_ID)"
OS_NAME="$(read_os_release_value NAME)"
OS_PRETTY_NAME="$(read_os_release_value PRETTY_NAME)"
OS_ID_LIKE="$(read_os_release_value ID_LIKE)"
DEB_ARCHITECTURE="$(dpkg --print-architecture)"
OS_DESCRIPTION="${OS_ID,,} ${OS_NAME,,} ${OS_PRETTY_NAME,,} ${OS_ID_LIKE,,}"
if [[ "$OS_DESCRIPTION" == *astra* ]]; then
  OS_FAMILY="astra"
elif [[ "$OS_ID" == "debian" || " ${OS_ID_LIKE,,} " == *" debian "* ]]; then
  OS_FAMILY="debian"
else
  die "Поддерживаются только Debian и Astra Linux; обнаружено: ${OS_PRETTY_NAME:-$OS_ID}."
fi
[[ "$OS_ID" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "Некорректный ID в /etc/os-release"
[[ "$OS_VERSION_ID" =~ ^[A-Za-z0-9][A-Za-z0-9.+:~_-]*$ ]] || \
  die "Некорректный VERSION_ID в /etc/os-release"
[[ "$DEB_ARCHITECTURE" =~ ^[a-z0-9][a-z0-9-]*$ ]] || \
  die "Некорректная Debian-архитектура: $DEB_ARCHITECTURE"

mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(absolute_path "$OUTPUT_DIR")"
rm -rf "$OUTPUT_DIR/partial"
rm -f "$OUTPUT_DIR"/*.deb \
  "$OUTPUT_DIR/manifest.sha256" \
  "$OUTPUT_DIR/packages.tsv" \
  "$OUTPUT_DIR/requested-packages.txt" \
  "$OUTPUT_DIR/source-os.env" \
  "$OUTPUT_DIR/lock"
mkdir -p "$OUTPUT_DIR/partial"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/docomator-apt-closure.XXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
  rm -rf "$OUTPUT_DIR/partial"
  rm -f "$OUTPUT_DIR/lock"
}
trap cleanup EXIT
: > "$WORK_DIR/status"

if ((RUN_UPDATE == 1)); then
  apt-get update
fi

info "Собираем полное замыкание зависимостей для: ${packages[*]}"
apt-get \
  -o "Dir::Cache::archives=$OUTPUT_DIR" \
  -o "Dir::State::status=$WORK_DIR/status" \
  -o APT::Keep-Downloaded-Packages=true \
  -o Debug::NoLocking=1 \
  --download-only \
  --no-install-recommends \
  --yes \
  install -- "${packages[@]}"

mapfile -d '' debs < <(
  find "$OUTPUT_DIR" -maxdepth 1 -type f -name '*.deb' -print0 | LC_ALL=C sort -z
)
((${#debs[@]} > 0)) || die "APT не скачал ни одного Debian-пакета."
printf '%s\n' "${packages[@]}" | LC_ALL=C sort > "$OUTPUT_DIR/requested-packages.txt"
REQUESTED_PACKAGES_SHA256="$(sha256_of "$OUTPUT_DIR/requested-packages.txt")"

(
  cd "$OUTPUT_DIR"
  find . -maxdepth 1 -type f -name '*.deb' -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum > manifest.sha256
)

printf '%s\n' \
  "OS_FAMILY=$OS_FAMILY" \
  "OS_ID=$OS_ID" \
  "OS_VERSION_ID=$OS_VERSION_ID" \
  "DEB_ARCHITECTURE=$DEB_ARCHITECTURE" \
  "DEPENDENCY_CLOSURE=full" \
  "APT_INSTALL_RECOMMENDS=false" \
  "REQUESTED_PACKAGES_SHA256=$REQUESTED_PACKAGES_SHA256" \
  > "$OUTPUT_DIR/source-os.env"

ROWS="$WORK_DIR/packages.rows.tsv"
: > "$ROWS"
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
    >> "$ROWS"
done
{
  printf 'sha256\tpackage\tversion\tarchitecture\tfilename\n'
  LC_ALL=C sort -t $'\t' -k5,5 "$ROWS"
} > "$OUTPUT_DIR/packages.tsv"

verify_os_package_set "$OUTPUT_DIR" 0

info "Полное замыкание собрано: ${#debs[@]} пакетов в $OUTPUT_DIR"
info "Профиль: $OS_FAMILY / $OS_ID $OS_VERSION_ID / $DEB_ARCHITECTURE"
