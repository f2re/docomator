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

set -a
# Созданный файл содержит только простые присваивания КЛЮЧ=ЗНАЧЕНИЕ.
# shellcheck disable=SC1090
source "$CONFIG_DIR/docomator.env"
set +a
export DOCOMATOR_HOST=127.0.0.1
export DOCOMATOR_PORT=18081

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
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \
  | grep -F 'Проверяем архивную структуру' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \
  | grep -F 'Читаем текст и координаты' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" \
  | grep -F 'Сохранить поле' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/styles.css" \
  | grep -F '.structure-element-list' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/ui/styles.css" \
  | grep -F '.structure-field-form' >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCOMATOR_PORT}/" \
  | grep -F 'Проверить документ' >/dev/null
"$INSTALL_ROOT/current/first-run.sh" \
  --url "http://127.0.0.1:${DOCOMATOR_PORT}" \
  --check \
  | grep -F 'сохраните поле' >/dev/null

kill "$API_PID"
wait "$API_PID" 2>/dev/null || true
API_PID=""

info "Проверяем автономное обновление той же неизменяемой версии"
"$BUNDLE_ROOT/update.sh" "${COMMON_ARGS[@]}"

BACKUP_COUNT="$(find "$DATA_DIR/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)"
((BACKUP_COUNT >= 1)) || die "Обновление не создало резервную копию перед заменой версии"

info "Проверка автономной установки и обновления пройдена"
