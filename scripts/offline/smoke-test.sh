#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE'
Использование: scripts/offline/smoke-test.sh КАТАЛОГ_РАСПАКОВАННОГО_КОМПЛЕКТА

Проверяет автономную установку и обновление во временных каталогах без сети.
Проверка не использует systemd и запускает службы от существующей учётной записи nobody.
Требуются права root, поскольку рабочий установщик изменяет владельцев файлов.
USAGE
}

if (($# != 1)); then
  usage >&2
  exit 2
fi

require_root
require_command curl
require_command getent

BUNDLE_ROOT="$(absolute_path "$1")"
[[ -x "$BUNDLE_ROOT/install.sh" ]] || die "В комплекте не найден исполняемый install.sh: $BUNDLE_ROOT"
[[ -x "$BUNDLE_ROOT/update.sh" ]] || die "В комплекте не найден исполняемый update.sh: $BUNDLE_ROOT"

if ! id nobody >/dev/null 2>&1; then
  die "Для проверки требуется стандартная учётная запись nobody"
fi
TEST_GROUP="$(id -gn nobody)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/docomator-install-smoke.XXXXXX")"
INSTALL_ROOT="$TEST_ROOT/opt/docomator"
DATA_DIR="$TEST_ROOT/var/lib/docomator"
CONFIG_DIR="$TEST_ROOT/etc/docomator"
API_PID=""

cleanup() {
  if [[ -n "$API_PID" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

COMMON_ARGS=(
  --bundle-root "$BUNDLE_ROOT"
  --install-root "$INSTALL_ROOT"
  --data-dir "$DATA_DIR"
  --config-dir "$CONFIG_DIR"
  --user nobody
  --group "$TEST_GROUP"
  --no-systemd
)

info "Выполняем первую автономную установку"
"$BUNDLE_ROOT/install.sh" "${COMMON_ARGS[@]}"

[[ -L "$INSTALL_ROOT/current" ]] || die "Не создана ссылка на текущую версию"
[[ -f "$DATA_DIR/docomator.db" ]] || die "Не создана база данных"
[[ -f "$CONFIG_DIR/docomator.env" ]] || die "Не создан файл настроек"
grep -F 'DOCOMATOR_PREVIEW_ENABLED=true' "$CONFIG_DIR/docomator.env" >/dev/null
grep -F 'DOCOMATOR_LIBREOFFICE_BIN=' "$CONFIG_DIR/docomator.env" >/dev/null
grep -F 'DOCOMATOR_BACKUP_ENABLED=true' "$CONFIG_DIR/docomator.env" >/dev/null
grep -F 'DOCOMATOR_BACKUP_RETENTION=7' "$CONFIG_DIR/docomator.env" >/dev/null
[[ -f "$INSTALL_ROOT/current/deploy/systemd/docomator-backup.service.in" ]] || \
  die "Не установлен шаблон службы резервирования"
[[ -f "$INSTALL_ROOT/current/deploy/systemd/docomator-backup.timer.in" ]] || \
  die "Не установлен шаблон таймера резервирования"

set -a
# Созданный файл содержит только простые присваивания КЛЮЧ=ЗНАЧЕНИЕ.
# shellcheck disable=SC1090
source "$CONFIG_DIR/docomator.env"
set +a
export DOCOMATOR_HOST=127.0.0.1
export DOCOMATOR_PORT=18081

info "Создаём проверенную копию тем же сценарием, который вызывает systemd"
DOCOMATOR_DATA_DIR="$DATA_DIR" \
DOCOMATOR_CONFIG_FILE="$CONFIG_DIR/docomator.env" \
DOCOMATOR_BACKUP_ENABLED=true \
DOCOMATOR_BACKUP_RETENTION=2 \
  "$INSTALL_ROOT/current/runtime/node/bin/node" \
  "$INSTALL_ROOT/current/app/scripts/runtime/automatic-backup.mjs" \
  | grep -F '"status":"ok"' >/dev/null
grep -F '"state": "completed"' \
  "$DATA_DIR/backups/automatic-backup-status.json" >/dev/null
[[ "$(find "$DATA_DIR/backups" -mindepth 2 -maxdepth 2 -type f -name manifest.json | wc -l)" -ge 1 ]] || \
  die "Автоматический сценарий не создал проверенную копию"

info "Запускаем встроенную службу для проверки готовности"
"$INSTALL_ROOT/current/runtime/node/bin/node" \
  "$INSTALL_ROOT/current/app/apps/api/dist/server.js" \
  >"$TEST_ROOT/api.log" 2>&1 &
API_PID=$!

READY=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error \
    "http://127.0.0.1:${DOCOMATOR_PORT}/readyz" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.2
done
((READY == 1)) || {
  cat "$TEST_ROOT/api.log" >&2 || true
  die "Встроенная служба не перешла в состояние готовности"
}

curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/" \
  | grep -F 'Пространства' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/api/v1/spaces?limit=10" \
  | grep -F 'Основное пространство' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/api/v1/spaces/00000000-0000-4000-8000-000000000001/active-templates" \
  | grep -F '"data":[]' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \
  | grep -F 'Проверяем архивную структуру' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \
  | grep -F 'Читаем текст и координаты' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \
  | grep -F 'Сохранить поле' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \
  | grep -F 'Проверить заполнение' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \
  | grep -F 'Проверить все поля' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \
  | grep -F 'Создать предварительный просмотр' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \
  | grep -F 'Активировать версию' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/styles.css" \
  | grep -F '.structure-element-list' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/styles.css" \
  | grep -F '.structure-field-form' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/styles.css" \
  | grep -F '.trial-downloads' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/styles.css" \
  | grep -F '.multi-trial-check-list' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/styles.css" \
  | grep -F '.activation-preview-frame' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/" \
  | grep -F 'Проверить документ' >/dev/null
"$INSTALL_ROOT/current/first-run.sh" \
  --url "http://127.0.0.1:${DOCOMATOR_PORT}" \
  --config "$CONFIG_DIR/docomator.env" \
  --check \
  | grep -F 'Готовность системы' >/dev/null

kill "$API_PID"
wait "$API_PID" 2>/dev/null || true
API_PID=""

info "Проверяем автономное обновление той же неизменяемой версии"
"$BUNDLE_ROOT/update.sh" "${COMMON_ARGS[@]}"

BACKUP_COUNT="$(find "$DATA_DIR/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)"
((BACKUP_COUNT >= 2)) || die "Обновление не сохранило автоматическую и предустановочную копии"

info "Проверка автономной установки, резервирования и обновления пройдена"
