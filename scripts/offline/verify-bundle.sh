#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

BUNDLE_ROOT="${1:-$SCRIPT_DIR}"
BUNDLE_ROOT="$(absolute_path "$BUNDLE_ROOT")"

require_command cmp
require_command find
require_command realpath
require_command sed
require_command sha256sum
require_command sort

[[ -f "$BUNDLE_ROOT/VERSION" ]] || die "В комплекте отсутствует VERSION: $BUNDLE_ROOT"
[[ -f "$BUNDLE_ROOT/manifest.sha256" ]] || die "В комплекте отсутствует manifest.sha256"
[[ -f "$BUNDLE_ROOT/manifest.symlinks" ]] || die "В комплекте отсутствует manifest.symlinks"
[[ -d "$BUNDLE_ROOT/payload/app" ]] || die "В комплекте отсутствует payload/app"
[[ -x "$BUNDLE_ROOT/payload/runtime/node/bin/node" ]] || die "В комплекте отсутствует встроенный Node.js"
[[ -f "$BUNDLE_ROOT/payload/app/scripts/runtime/automatic-backup.mjs" ]] || \
  die "В комплекте отсутствует сценарий автоматического резервирования"
[[ -f "$BUNDLE_ROOT/payload/app/scripts/runtime/pilot-readiness.mjs" ]] || \
  die "В комплекте отсутствует сценарий пилотной приёмки"
[[ -f "$BUNDLE_ROOT/payload/app/scripts/runtime/pilot-check.sh" ]] || \
  die "В комплекте отсутствует штатный запуск пилотной приёмки"
[[ -f "$BUNDLE_ROOT/payload/deploy/systemd/docomator-backup.service.in" ]] || \
  die "В комплекте отсутствует служба автоматического резервирования"
[[ -f "$BUNDLE_ROOT/payload/deploy/systemd/docomator-backup.timer.in" ]] || \
  die "В комплекте отсутствует таймер автоматического резервирования"
[[ -f "$BUNDLE_ROOT/payload/app/examples/README.md" ]] || \
  die "В комплекте отсутствует описание учебных примеров"
[[ -f "$BUNDLE_ROOT/payload/app/examples/manifest.sha256" ]] || \
  die "В комплекте отсутствует manifest учебных примеров"

TEMP_DIR="$(mktemp -d "/tmp/docomator-verify.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT

while IFS= read -r -d '' entry; do
  [[ ! "$entry" =~ [[:cntrl:]] ]] || \
    die "В комплекте найдено имя с управляющим символом"
done < <(cd "$BUNDLE_ROOT" && find . -mindepth 1 -print0)

(
  cd "$BUNDLE_ROOT"
  sed -E 's/^[a-f0-9]{64}  //' manifest.sha256 \
    | LC_ALL=C sort > "$TEMP_DIR/expected-files"
  printf '%s\n' './manifest.sha256' \
    | LC_ALL=C sort -m - "$TEMP_DIR/expected-files" \
      > "$TEMP_DIR/expected-files-with-root"
  find . -type f -print \
    | LC_ALL=C sort > "$TEMP_DIR/actual-files"
)
cmp -s "$TEMP_DIR/expected-files-with-root" "$TEMP_DIR/actual-files" || \
  die "Состав обычных файлов комплекта не совпадает с manifest.sha256"

if find "$BUNDLE_ROOT" -mindepth 1 ! -type d ! -type f ! -type l -print -quit \
  | grep -q .; then
  die "В комплекте найден объект неподдерживаемого типа"
fi

info "Проверяем контрольные суммы автономного комплекта"
(
  cd "$BUNDLE_ROOT"
  sha256sum --check --strict --quiet manifest.sha256
)

write_symlink_manifest "$BUNDLE_ROOT" "$TEMP_DIR/actual-symlinks"
cmp -s "$BUNDLE_ROOT/manifest.symlinks" "$TEMP_DIR/actual-symlinks" || \
  die "Состав или цели символических ссылок комплекта изменены"

EXAMPLE_FILES=(
  "README.md"
  "data/employees.csv"
  "expected/personal-card-filled.docx"
  "expected/team-register-filled.xlsx"
  "manifest.sha256"
  "templates/personal-card.docx"
  "templates/team-register.xlsx"
)
EXAMPLE_HASHED_FILES=(
  "data/employees.csv"
  "expected/personal-card-filled.docx"
  "expected/team-register-filled.xlsx"
  "templates/personal-card.docx"
  "templates/team-register.xlsx"
)
printf '%s\n' "${EXAMPLE_FILES[@]}" \
  | LC_ALL=C sort > "$TEMP_DIR/expected-examples"
(
  cd "$BUNDLE_ROOT/payload/app/examples"
  find . -type f -print \
    | sed 's|^\./||' \
    | LC_ALL=C sort > "$TEMP_DIR/actual-examples"
)
cmp -s "$TEMP_DIR/expected-examples" "$TEMP_DIR/actual-examples" || \
  die "Состав учебных примеров не совпадает с обязательным списком"
if find "$BUNDLE_ROOT/payload/app/examples" -type l -print -quit | grep -q .; then
  die "В каталоге учебных примеров запрещены символические ссылки"
fi
printf '%s\n' "${EXAMPLE_HASHED_FILES[@]}" \
  | LC_ALL=C sort > "$TEMP_DIR/expected-example-manifest-paths"
sed -E 's/^[a-f0-9]{64}  //' \
  "$BUNDLE_ROOT/payload/app/examples/manifest.sha256" \
  | LC_ALL=C sort > "$TEMP_DIR/actual-example-manifest-paths"
cmp -s \
  "$TEMP_DIR/expected-example-manifest-paths" \
  "$TEMP_DIR/actual-example-manifest-paths" || \
  die "Пути в manifest учебных примеров не совпадают с разрешённым списком"
info "Проверяем контрольные суммы учебных примеров"
(
  cd "$BUNDLE_ROOT/payload/app/examples"
  sha256sum --check --strict --quiet manifest.sha256
)
info "Автономный комплект корректен: версия $(<"$BUNDLE_ROOT/VERSION")"
