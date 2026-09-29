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
require_command getent
require_command sha256sum
require_command stat
require_command runuser

BUNDLE_ROOT="$(absolute_path "$1")"
[[ -x "$BUNDLE_ROOT/install.sh" ]] || die "В комплекте не найден исполняемый install.sh: $BUNDLE_ROOT"
[[ -x "$BUNDLE_ROOT/update.sh" ]] || die "В комплекте не найден исполняемый update.sh: $BUNDLE_ROOT"
[[ -f "$BUNDLE_ROOT/http-check.mjs" ]] || die "В комплекте не найден http-check.mjs: $BUNDLE_ROOT"
BUNDLE_NODE="$BUNDLE_ROOT/payload/runtime/node/bin/node"
[[ -x "$BUNDLE_NODE" ]] || die "В комплекте не найден встроенный Node.js"

http_check() {
  if [[ -f "$TEST_ROOT/workspace-session.json" ]]; then
    DOCOMATOR_HTTP_SESSION_FILE="$TEST_ROOT/workspace-session.json" \
      "$BUNDLE_NODE" "$BUNDLE_ROOT/http-check.mjs" "$1" "${2:-}"
  else
    "$BUNDLE_NODE" "$BUNDLE_ROOT/http-check.mjs" "$1" "${2:-}"
  fi
}

workspace_check() {
  "$BUNDLE_NODE" --input-type=module - "$1" \
    "http://127.0.0.1:${DOCOMATOR_PORT}" "$TEST_ROOT/workspace-session.json" <<'NODE'
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import fs from "node:fs/promises";
const [mode, origin, sessionFile] = process.argv.slice(2);
const request = (pathname, options = {}) => fetch(`${origin}${pathname}`, {
  ...options, redirect: "manual", signal: AbortSignal.timeout(5000)
});
let session;
if (mode === "setup") {
  const closed = await request("/");
  assert.ok([302, 303].includes(closed.status), "fresh UI must require the access code");
  assert.match(closed.headers.get("location"), /^\/access(?:\?|$)/u);
  const denied = await request("/api/v1/spaces?limit=10");
  assert.equal(denied.status, 401, "fresh API must remain closed");
  assert.equal(denied.headers.get("www-authenticate"), null);
  const code = String(randomInt(0, 10000)).padStart(4, "0");
  const setup = await request("/api/v1/access/setup", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ code })
  });
  assert.equal(setup.status, 200, "explicit first-run code setup must succeed");
  const cookie = setup.headers.getSetCookie().map((value) => value.split(";")[0])
    .find((value) => value.startsWith("docomator_session="));
  assert.ok(cookie, "setup must issue a real session");
  const spaces = await request("/api/v1/spaces?limit=10", { headers: { cookie } });
  assert.equal(spaces.status, 200);
  const spaceId = (await spaces.json()).data[0].id;
  const displayName = "Проверка сохранности после обновления";
  const created = await request(`/api/v1/spaces/${spaceId}/employees`, {
    method: "POST", headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({ displayName })
  });
  assert.equal(created.status, 201);
  const employee = (await created.json()).data;
  session = { origin, cookie, spaceId, employeeId: employee.id || employee.entityId, displayName };
  assert.ok(session.employeeId);
  await fs.writeFile(sessionFile, JSON.stringify(session), { mode: 0o600, flag: "wx" });
} else {
  assert.equal(mode, "verify");
  session = JSON.parse(await fs.readFile(sessionFile, "utf8"));
  assert.equal(session.origin, origin);
}
const employee = await request(`/api/v1/spaces/${session.spaceId}/employees/${session.employeeId}`, {
  headers: { cookie: session.cookie }
});
assert.equal(employee.status, 200, "the original session and employee must survive the update");
assert.equal((await employee.json()).data.displayName, session.displayName);
console.log(mode === "setup" ? "Первый запуск: код настроен, карточка сохранена." : "Обновление: прежняя сессия и карточка сохранены.");
NODE
}

if ! id nobody >/dev/null 2>&1; then
  die "Для проверки требуется стандартная учётная запись nobody"
fi
TEST_GROUP="$(id -gn nobody)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/docomator-install-smoke.XXXXXX")"
chmod 0755 "$TEST_ROOT"
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
BUNDLE_PREVIEW_ENABLED="$(read_env_value \
  "$BUNDLE_ROOT/payload/config/docomator.env.example" \
  DOCOMATOR_PREVIEW_ENABLED)"
grep -F "DOCOMATOR_PREVIEW_ENABLED=$BUNDLE_PREVIEW_ENABLED" \
  "$CONFIG_DIR/docomator.env" >/dev/null
grep -F 'DOCOMATOR_LIBREOFFICE_BIN=' "$CONFIG_DIR/docomator.env" >/dev/null
grep -F 'DOCOMATOR_PREVIEW_TIMEOUT_MS=' "$CONFIG_DIR/docomator.env" >/dev/null
grep -F 'DOCOMATOR_PREVIEW_MAX_BYTES=' "$CONFIG_DIR/docomator.env" >/dev/null
if [[ "$BUNDLE_PREVIEW_ENABLED" == "true" ]]; then
  SMOKE_LIBREOFFICE_BIN="$(read_env_value "$CONFIG_DIR/docomator.env" DOCOMATOR_LIBREOFFICE_BIN)"
  [[ -x "$SMOKE_LIBREOFFICE_BIN" ]] || \
    die "Preview включён, но LibreOffice недоступен: $SMOKE_LIBREOFFICE_BIN"
fi
grep -F 'DOCOMATOR_BACKUP_ENABLED=true' "$CONFIG_DIR/docomator.env" >/dev/null
grep -F 'DOCOMATOR_BACKUP_RETENTION=7' "$CONFIG_DIR/docomator.env" >/dev/null
[[ -f "$INSTALL_ROOT/current/deploy/systemd/docomator-backup.service.in" ]] || \
  die "Не установлен шаблон службы резервирования"
[[ -f "$INSTALL_ROOT/current/deploy/systemd/docomator-backup.timer.in" ]] || \
  die "Не установлен шаблон таймера резервирования"
EXAMPLES_DIR="$INSTALL_ROOT/current/app/examples"
[[ -f "$EXAMPLES_DIR/manifest.sha256" ]] || \
  die "Не установлены проверяемые учебные примеры"
(
  cd "$EXAMPLES_DIR"
  sha256sum --check --strict --quiet manifest.sha256
)
if find "$EXAMPLES_DIR" -type l -print -quit | grep -q .; then
  die "Установленные учебные примеры содержат символическую ссылку"
fi
if find "$EXAMPLES_DIR" -type f -perm /022 -print -quit | grep -q .; then
  die "Установленные учебные примеры доступны для записи группе или остальным"
fi
while IFS= read -r -d '' example; do
  [[ "$(stat -c '%U:%G' "$example")" == "root:root" ]] || \
    die "Учебный пример должен принадлежать root:root: $example"
done < <(find "$EXAMPLES_DIR" -type f -print0)

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

start_api() {
  info "Запускаем встроенную службу от непривилегированной учётной записи"
  runuser -u nobody -- "$INSTALL_ROOT/current/runtime/node/bin/node" \
    "$INSTALL_ROOT/current/app/apps/api/dist/server.js" >"$TEST_ROOT/api.log" 2>&1 &
  API_PID=$!
  local ready=0
  for _ in $(seq 1 30); do
    if http_check "http://127.0.0.1:${DOCOMATOR_PORT}/readyz" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.2
  done
  ((ready == 1)) || {
    cat "$TEST_ROOT/api.log" >&2 || true
    die "Встроенная служба не перешла в состояние готовности"
  }
}
start_api
workspace_check setup

http_check "http://127.0.0.1:${DOCOMATOR_PORT}/" 'id="currentSpaceChip"'
http_check "http://127.0.0.1:${DOCOMATOR_PORT}/api/v1/spaces?limit=10" 'Основное пространство'
http_check \
  "http://127.0.0.1:${DOCOMATOR_PORT}/api/v1/spaces/00000000-0000-4000-8000-000000000001/active-templates" \
  '"data":[]'
for expected in \
  'inspectSelectedFile' \
  'analyzeStructure' \
  'saveSelectedField' \
  'submitTrialVersion' \
  'submitMultiTrial' \
  'requestTemplatePreview' \
  'activateTemplateVersionDirect'; do
  http_check "http://127.0.0.1:${DOCOMATOR_PORT}/ui/document-intake.js" "$expected"
done
for expected in \
  '.structure-element-list' \
  '.structure-field-form' \
  '.trial-downloads' \
  '.multi-trial-check-list' \
  '.activation-preview-frame'; do
  http_check "http://127.0.0.1:${DOCOMATOR_PORT}/ui/styles.css" "$expected"
done
http_check "http://127.0.0.1:${DOCOMATOR_PORT}/" 'id="documentIntakeFile"'
"$INSTALL_ROOT/current/first-run.sh" \
  --url "http://127.0.0.1:${DOCOMATOR_PORT}" \
  --config "$CONFIG_DIR/docomator.env" \
  --check \
  | grep -F 'Локальная служба готова' >/dev/null

kill "$API_PID"
wait "$API_PID" 2>/dev/null || true
API_PID=""

info "Проверяем автономное обновление той же неизменяемой версии"
"$BUNDLE_ROOT/update.sh" "${COMMON_ARGS[@]}"

BACKUP_COUNT="$(find "$DATA_DIR/backups" -mindepth 1 -maxdepth 1 -type d | wc -l)"
((BACKUP_COUNT >= 2)) || die "Обновление не сохранило автоматическую и предустановочную копии"

start_api
workspace_check verify
http_check "http://127.0.0.1:${DOCOMATOR_PORT}/" 'id="currentSpaceChip"'

info "Проверка автономной установки, резервирования и обновления пройдена"
