#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

BUNDLE_ROOT="${1:-$SCRIPT_DIR}"
BUNDLE_ROOT="$(absolute_path "$BUNDLE_ROOT")"

[[ -f "$BUNDLE_ROOT/VERSION" ]] || die "В комплекте отсутствует VERSION: $BUNDLE_ROOT"
[[ -f "$BUNDLE_ROOT/manifest.sha256" ]] || die "В комплекте отсутствует manifest.sha256"
[[ -d "$BUNDLE_ROOT/payload/app" ]] || die "В комплекте отсутствует payload/app"
[[ -x "$BUNDLE_ROOT/payload/runtime/node/bin/node" ]] || die "В комплекте отсутствует встроенный Node.js"
[[ -f "$BUNDLE_ROOT/payload/app/scripts/runtime/automatic-backup.mjs" ]] || \
  die "В комплекте отсутствует сценарий автоматического резервирования"
[[ -f "$BUNDLE_ROOT/payload/deploy/systemd/docomator-backup.service.in" ]] || \
  die "В комплекте отсутствует служба автоматического резервирования"
[[ -f "$BUNDLE_ROOT/payload/deploy/systemd/docomator-backup.timer.in" ]] || \
  die "В комплекте отсутствует таймер автоматического резервирования"

info "Проверяем контрольные суммы автономного комплекта"
(
  cd "$BUNDLE_ROOT"
  sha256sum --check --strict --quiet manifest.sha256
)
info "Автономный комплект корректен: версия $(<"$BUNDLE_ROOT/VERSION")"
