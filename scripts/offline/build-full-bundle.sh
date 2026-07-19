#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

TARGET=""
LLAMA_SERVER=""
MODEL_FILE=""
PACKAGE_LIST="$ROOT_DIR/config/os-packages.txt"
OS_PACKAGES_DIR=""
RUN_APT_UPDATE=0
NODE_RUNTIME_DIR=""
NODE_ARCHIVE=""
NODE_SHA256=""
UX_CHROMIUM_PACKAGE=""
UX_CHROMIUM_BIN=""
FORCE=0

usage() {
  cat <<'USAGE'
Использование: scripts/offline/build-full-bundle.sh [параметры]

Собирает полный target-specific offline bundle с локальной моделью,
LibreOffice preview и offline UX acceptance. Команду запускают обычным
пользователем на подключённой эталонной VM той же ОС и архитектуры, что target.
Для сбора .deb сценарий отдельно вызывает sudo.

Параметры:
  --target debian|astra       обязательный целевой профиль ОС
  --llama-server ФАЙЛ         target-compatible llama-server
  --model ФАЙЛ                GGUF-модель
  --package-list ФАЙЛ         исходный список .deb (по умолчанию config/os-packages.txt)
  --os-packages-dir КАТАЛОГ   использовать уже собранный точный набор .deb без sudo
  --apt-update                выполнить apt-get update перед новым сбором .deb
  --node-runtime-dir КАТАЛОГ  использовать распакованный target Node.js
  --node-archive ФАЙЛ         использовать локальный официальный Node.js .tar.xz
  --node-sha256 SHA256        ожидаемая сумма для --node-archive
  --ux-chromium-package ИМЯ   пакет Chromium; для Debian по умолчанию chromium
  --ux-chromium-bin ПУТЬ      executable Chromium; для Debian /usr/bin/chromium
  --force                     заменить существующий bundle той же версии
  -h, --help                  показать эту справку

Astra Linux не получает неявных значений Chromium: пакет и абсолютный путь
необходимо подтвердить на конкретной эталонной VM и передать явно.
USAGE
}

need_value() {
  local option="$1"
  local count="$2"
  ((count >= 2)) || die "После $option необходимо указать значение."
}

while (($# > 0)); do
  case "$1" in
    --target)
      need_value "$1" "$#"
      TARGET="$2"
      shift 2
      ;;
    --llama-server)
      need_value "$1" "$#"
      LLAMA_SERVER="$2"
      shift 2
      ;;
    --model)
      need_value "$1" "$#"
      MODEL_FILE="$2"
      shift 2
      ;;
    --package-list)
      need_value "$1" "$#"
      PACKAGE_LIST="$2"
      shift 2
      ;;
    --os-packages-dir)
      need_value "$1" "$#"
      OS_PACKAGES_DIR="$2"
      shift 2
      ;;
    --apt-update)
      RUN_APT_UPDATE=1
      shift
      ;;
    --node-runtime-dir)
      need_value "$1" "$#"
      NODE_RUNTIME_DIR="$2"
      shift 2
      ;;
    --node-archive)
      need_value "$1" "$#"
      NODE_ARCHIVE="$2"
      shift 2
      ;;
    --node-sha256)
      need_value "$1" "$#"
      NODE_SHA256="$2"
      shift 2
      ;;
    --ux-chromium-package)
      need_value "$1" "$#"
      UX_CHROMIUM_PACKAGE="$2"
      shift 2
      ;;
    --ux-chromium-bin)
      need_value "$1" "$#"
      UX_CHROMIUM_BIN="$2"
      shift 2
      ;;
    --force)
      FORCE=1
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

[[ "${EUID:-$(id -u)}" -ne 0 ]] || \
  die "Полную сборку запускают обычным пользователем; root используется только внутренним шагом сбора .deb."
[[ "$TARGET" == "debian" || "$TARGET" == "astra" ]] || \
  die "Укажите --target debian или --target astra."
[[ -n "$LLAMA_SERVER" && -n "$MODEL_FILE" ]] || \
  die "Полный bundle требует одновременно --llama-server и --model."
[[ -f "$LLAMA_SERVER" ]] || die "Не найден llama-server: $LLAMA_SERVER"
[[ -f "$MODEL_FILE" ]] || die "Не найдена GGUF-модель: $MODEL_FILE"
[[ -z "$NODE_RUNTIME_DIR" || -z "$NODE_ARCHIVE" ]] || \
  die "Используйте только один из параметров --node-runtime-dir и --node-archive."
[[ -z "$NODE_SHA256" || -n "$NODE_ARCHIVE" ]] || \
  die "--node-sha256 разрешён только вместе с --node-archive."
if [[ -n "$NODE_ARCHIVE" ]]; then
  [[ -f "$NODE_ARCHIVE" ]] || die "Не найден архив Node.js: $NODE_ARCHIVE"
  [[ "$NODE_SHA256" =~ ^[a-f0-9]{64}$ ]] || \
    die "Для --node-archive требуется точный SHA-256 через --node-sha256."
fi
if [[ -n "$NODE_RUNTIME_DIR" ]]; then
  [[ -x "$NODE_RUNTIME_DIR/bin/node" ]] || \
    die "Каталог Node.js не содержит исполнимый bin/node: $NODE_RUNTIME_DIR"
fi
if [[ -n "$OS_PACKAGES_DIR" && $RUN_APT_UPDATE -eq 1 ]]; then
  die "--apt-update неприменим вместе с готовым --os-packages-dir."
fi

case "$TARGET" in
  debian)
    UX_CHROMIUM_PACKAGE="${UX_CHROMIUM_PACKAGE:-chromium}"
    UX_CHROMIUM_BIN="${UX_CHROMIUM_BIN:-/usr/bin/chromium}"
    ;;
  astra)
    [[ -n "$UX_CHROMIUM_PACKAGE" && -n "$UX_CHROMIUM_BIN" ]] || \
      die "Для Astra явно укажите --ux-chromium-package и --ux-chromium-bin."
    ;;
esac
[[ "$UX_CHROMIUM_PACKAGE" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || \
  die "Некорректное имя пакета Chromium: $UX_CHROMIUM_PACKAGE"
[[ "$UX_CHROMIUM_BIN" =~ ^/[A-Za-z0-9._/+:-]+$ ]] || \
  die "Путь Chromium должен быть безопасным абсолютным путём: $UX_CHROMIUM_BIN"

require_command dpkg
require_command dpkg-deb
require_command sed
[[ -f /etc/os-release ]] || die "Не найден /etc/os-release."

read_os_release_value() {
  local key="$1"
  local value
  value="$(grep -E "^[[:space:]]*${key}=" /etc/os-release | head -n 1 | cut -d= -f2- || true)"
  if [[ ${#value} -ge 2 ]]; then
    if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf '%s' "$value"
}

OS_ID="$(read_os_release_value ID)"
OS_VERSION_ID="$(read_os_release_value VERSION_ID)"
OS_NAME="$(read_os_release_value NAME)"
OS_PRETTY_NAME="$(read_os_release_value PRETTY_NAME)"
DEB_ARCHITECTURE="$(dpkg --print-architecture)"
[[ "$OS_ID" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "Некорректный ID эталонной ОС."
[[ "$OS_VERSION_ID" =~ ^[A-Za-z0-9][A-Za-z0-9.+:~_-]*$ ]] || \
  die "Некорректный VERSION_ID эталонной ОС."
[[ "$DEB_ARCHITECTURE" =~ ^[a-z0-9][a-z0-9-]*$ ]] || \
  die "Некорректная Debian-архитектура: $DEB_ARCHITECTURE"

OS_DESCRIPTION="${OS_ID,,} ${OS_NAME,,} ${OS_PRETTY_NAME,,}"
case "$TARGET" in
  debian)
    [[ "$OS_ID" == "debian" ]] || \
      die "Команда Debian должна выполняться на Debian reference VM; обнаружено: ${OS_PRETTY_NAME:-$OS_ID}."
    ;;
  astra)
    [[ "$OS_DESCRIPTION" == *astra* ]] || \
      die "Команда Astra должна выполняться на Astra Linux reference VM; обнаружено: ${OS_PRETTY_NAME:-$OS_ID}."
    ;;
esac

case "$DEB_ARCHITECTURE" in
  amd64)
    TARGET_ARCH="x86_64"
    NODE_ARCH="x64"
    ;;
  arm64)
    TARGET_ARCH="aarch64"
    NODE_ARCH="arm64"
    ;;
  *)
    die "Полная сборка пока поддерживает только amd64 и arm64: $DEB_ARCHITECTURE"
    ;;
esac

PROFILE_VERSION="$(printf '%s' "$OS_VERSION_ID" | sed -E 's/[^A-Za-z0-9._-]+/_/g')"
PROFILE_ROOT="$ROOT_DIR/offline-bundles/targets/${TARGET}-${PROFILE_VERSION}-${DEB_ARCHITECTURE}"
BUNDLE_OUTPUT_DIR="$PROFILE_ROOT/release"
mkdir -p "$BUNDLE_OUTPUT_DIR"

TEMPORARY_DIRECTORY=""
cleanup() {
  if [[ -n "$TEMPORARY_DIRECTORY" ]]; then
    rm -rf "$TEMPORARY_DIRECTORY"
  fi
}
trap cleanup EXIT

if [[ -z "$OS_PACKAGES_DIR" ]]; then
  require_command sudo
  [[ -f "$PACKAGE_LIST" ]] || die "Не найден список пакетов ОС: $PACKAGE_LIST"
  PACKAGE_LIST="$(absolute_path "$PACKAGE_LIST")"
  OS_PACKAGES_DIR="$PROFILE_ROOT/os-packages"
  TEMPORARY_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/docomator-full-bundle.XXXXXX")"
  EFFECTIVE_PACKAGE_LIST="$TEMPORARY_DIRECTORY/os-packages.txt"

  declare -A package_names=()
  browser_package_written=0
  while IFS= read -r package; do
    [[ -n "$package" ]] || continue
    if [[ "$package" == "chromium" ]]; then
      package="$UX_CHROMIUM_PACKAGE"
    fi
    [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || \
      die "Некорректное имя в package list: $package"
    [[ -z "${package_names[$package]+x}" ]] || \
      die "После выбора Chromium package list содержит повтор: $package"
    package_names[$package]=1
    [[ "$package" == "$UX_CHROMIUM_PACKAGE" ]] && browser_package_written=1
    printf '%s\n' "$package" >> "$EFFECTIVE_PACKAGE_LIST"
  done < <(
    sed -E 's/[[:space:]]*#.*$//' "$PACKAGE_LIST" \
      | awk '{$1=$1} NF {print}'
  )
  if ((browser_package_written == 0)); then
    printf '%s\n' "$UX_CHROMIUM_PACKAGE" >> "$EFFECTIVE_PACKAGE_LIST"
  fi

  collect_arguments=(
    sudo -- "$SCRIPT_DIR/collect-os-packages.sh"
    --package-list "$EFFECTIVE_PACKAGE_LIST"
    --output "$OS_PACKAGES_DIR"
  )
  if ((RUN_APT_UPDATE == 1)); then
    collect_arguments+=(--apt-update)
  fi
  info "Собираем точный набор .deb для ${OS_PRETTY_NAME:-$OS_ID} ${DEB_ARCHITECTURE}"
  "${collect_arguments[@]}"
else
  OS_PACKAGES_DIR="$(absolute_path "$OS_PACKAGES_DIR")"
fi

verify_os_package_set "$OS_PACKAGES_DIR" 1
verify_target_os_package_profile "$OS_PACKAGES_DIR" /etc/os-release "$DEB_ARCHITECTURE"

mapfile -t chromium_versions < <(
  awk -F '\t' -v package="$UX_CHROMIUM_PACKAGE" \
    'NR > 1 && $2 == package { print $3 }' \
    "$OS_PACKAGES_DIR/packages.tsv"
)
((${#chromium_versions[@]} == 1)) || \
  die "Набор .deb должен содержать ровно один пакет Chromium: $UX_CHROMIUM_PACKAGE"

LLAMA_SERVER="$(absolute_path "$LLAMA_SERVER")"
MODEL_FILE="$(absolute_path "$MODEL_FILE")"
prepare_arguments=(
  --output "$BUNDLE_OUTPUT_DIR"
  --target-arch "$TARGET_ARCH"
  --llama-server "$LLAMA_SERVER"
  --model "$MODEL_FILE"
  --with-preview
  --with-ux-acceptance
  --ux-chromium-package "$UX_CHROMIUM_PACKAGE"
  --ux-chromium-bin "$UX_CHROMIUM_BIN"
  --os-packages-dir "$OS_PACKAGES_DIR"
)
if [[ -n "$NODE_RUNTIME_DIR" ]]; then
  prepare_arguments+=(--node-runtime-dir "$(absolute_path "$NODE_RUNTIME_DIR")")
elif [[ -n "$NODE_ARCHIVE" ]]; then
  prepare_arguments+=(
    --node-archive "$(absolute_path "$NODE_ARCHIVE")"
    --node-sha256 "$NODE_SHA256"
  )
fi
if ((FORCE == 1)); then
  prepare_arguments+=(--force)
fi

info "Собираем полный $TARGET bundle: preview=on, UX acceptance=on, LLM=on"
"$SCRIPT_DIR/prepare-bundle.sh" "${prepare_arguments[@]}"

VERSION="$(<"$ROOT_DIR/VERSION")"
ARCHIVE="$BUNDLE_OUTPUT_DIR/docomator-${VERSION}-linux-${NODE_ARCH}.tar.gz"
CHECKSUM="$ARCHIVE.sha256"
[[ -f "$ARCHIVE" && -f "$CHECKSUM" ]] || \
  die "Сборщик завершился без ожидаемого архива или SHA-256."

info "Полный offline bundle для $TARGET создан."
printf 'Профиль: %s %s %s\n' "$OS_ID" "$OS_VERSION_ID" "$DEB_ARCHITECTURE"
printf 'Архив: %s\n' "$ARCHIVE"
printf 'SHA-256: %s\n' "$CHECKSUM"
printf 'Пакеты ОС: %s\n' "$OS_PACKAGES_DIR"
