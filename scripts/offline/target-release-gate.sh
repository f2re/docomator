#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

BUNDLE_ROOT="$SCRIPT_DIR"
CONFIG_FILE=""

usage() {
  cat <<'USAGE'
Использование: target-release-gate.sh [параметры]

Запускает обязательный core gate и, для preview-профиля, реальное преобразование
DOCX/XLSX встроенным production-кодом. Сеть и npm registry не используются.

Параметры:
  --bundle-root DIR   распакованный автономный комплект
  --config ФАЙЛ      настройки целевой установки; иначе используется шаблон bundle
  -h, --help          показать эту справку
USAGE
}

while (($# > 0)); do
  case "$1" in
    --bundle-root) BUNDLE_ROOT="$2"; shift 2 ;;
    --config) CONFIG_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

BUNDLE_ROOT="$(absolute_path "$BUNDLE_ROOT")"
[[ -n "$CONFIG_FILE" ]] || CONFIG_FILE="$BUNDLE_ROOT/payload/config/docomator.env.example"
[[ -f "$CONFIG_FILE" ]] || die "Не найден файл настроек: $CONFIG_FILE"
"$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"

NODE="$BUNDLE_ROOT/payload/runtime/node/bin/node"
APP_ROOT="$BUNDLE_ROOT/payload/app"
[[ -x "$NODE" ]] || die "Не найден встроенный Node.js"
[[ -f "$APP_ROOT/scripts/ci/release-gate.mjs" ]] || die "Не найден core release-gate"
[[ -f "$APP_ROOT/scripts/ci/libreoffice-release-gate.mjs" ]] || \
  die "Не найден LibreOffice release-gate"

mapfile -d '' BUNDLE_OS_DEBS < <(
  find "$BUNDLE_ROOT/payload/os-packages" -maxdepth 1 -type f -name '*.deb' -print0
)
if ((${#BUNDLE_OS_DEBS[@]} > 0)); then
  verify_target_os_package_profile "$BUNDLE_ROOT/payload/os-packages"
fi

BUNDLE_PREVIEW_ENABLED="$(read_env_value \
  "$BUNDLE_ROOT/payload/config/docomator.env.example" \
  DOCOMATOR_PREVIEW_ENABLED)"
CONFIG_PREVIEW_ENABLED="$(read_env_value "$CONFIG_FILE" DOCOMATOR_PREVIEW_ENABLED)"
[[ -n "$CONFIG_PREVIEW_ENABLED" ]] || CONFIG_PREVIEW_ENABLED="true"
[[ "$CONFIG_PREVIEW_ENABLED" == "$BUNDLE_PREVIEW_ENABLED" ]] || \
  die "Preview-профиль целевой конфигурации не совпадает с автономным комплектом"

info "Запускаем обязательный core release-gate из production payload"
(
  cd "$APP_ROOT"
  "$NODE" scripts/ci/release-gate.mjs
)

if [[ "$BUNDLE_PREVIEW_ENABLED" == "true" ]]; then
  LIBREOFFICE_BIN="$(read_env_value "$CONFIG_FILE" DOCOMATOR_LIBREOFFICE_BIN)"
  [[ -n "$LIBREOFFICE_BIN" ]] || LIBREOFFICE_BIN="/usr/bin/libreoffice"
  [[ "$LIBREOFFICE_BIN" == /* ]] || \
    die "DOCOMATOR_LIBREOFFICE_BIN должен быть абсолютным путём"
  [[ -x "$LIBREOFFICE_BIN" ]] || die "LibreOffice недоступен: $LIBREOFFICE_BIN"
  info "Запускаем обязательный gate реального LibreOffice"
  (
    cd "$APP_ROOT"
    DOCOMATOR_REQUIRE_LIBREOFFICE=1 \
    DOCOMATOR_LIBREOFFICE_BIN="$LIBREOFFICE_BIN" \
      "$NODE" scripts/ci/libreoffice-release-gate.mjs
  )
elif [[ "$BUNDLE_PREVIEW_ENABLED" == "false" ]]; then
  info "Preview-профиль отключён; LibreOffice gate неприменим к этому комплекту"
else
  die "Preview-профиль автономного комплекта повреждён"
fi

info "Целевые release-gate проверки пройдены"
