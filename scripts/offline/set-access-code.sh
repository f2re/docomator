#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"
CONFIG_FILE="/etc/docomator/docomator.env"
NODE_BIN="/opt/docomator/current/runtime/node/bin/node"
CODE_STDIN=0
NO_RESTART=0

usage() {
  cat <<'USAGE'
Использование: sudo set-access-code.sh [параметры]

Устанавливает или меняет общий четырёхзначный код доступа Оформлятора.
Сохраняется только scrypt-хэш. Смена кода ротирует секрет браузерных
сессий, поэтому ранее открытая рабочая область снова потребует код.

Параметры:
  --config ФАЙЛ    файл /etc/docomator/docomator.env
  --node ФАЙЛ      встроенный Node.js Оформлятора
  --code-stdin     прочитать четыре цифры из stdin
  --no-restart     не перезапускать docomator-api.service
  -h, --help       показать эту справку
USAGE
}

while (($# > 0)); do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --node) NODE_BIN="$2"; shift 2 ;;
    --code-stdin) CODE_STDIN=1; shift ;;
    --no-restart) NO_RESTART=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

require_root
[[ -f "$CONFIG_FILE" ]] || die "Файл конфигурации не найден: $CONFIG_FILE"
[[ -x "$NODE_BIN" ]] || die "Node.js Оформлятора не найден: $NODE_BIN"

if ((CODE_STDIN == 1)); then
  IFS= read -r ACCESS_CODE || true
else
  printf 'Новый код доступа (4 цифры): ' >&2
  IFS= read -r -s ACCESS_CODE
  printf '\n' >&2
fi

[[ "$ACCESS_CODE" =~ ^[0-9]{4}$ ]] || die "Код доступа должен состоять ровно из 4 цифр."

CREDENTIAL_HASH="$({ printf '%s' "$ACCESS_CODE"; } | "$NODE_BIN" --input-type=module -e '
  import { randomBytes, scryptSync } from "node:crypto";
  let code="";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) code+=chunk;
  if(!/^[0-9]{4}$/.test(code)){
    console.error("Код доступа должен состоять ровно из 4 цифр.");
    process.exit(2);
  }
  const salt=randomBytes(16);
  const digest=scryptSync(code,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  process.stdout.write(["scrypt-v1","16384","8","1",salt.toString("base64url"),digest.toString("base64url")].join(":"));
')"
unset ACCESS_CODE

SESSION_SECRET="$($NODE_BIN --input-type=module -e 'import { randomBytes } from "node:crypto";process.stdout.write(randomBytes(48).toString("base64url"));')"
replace_env_value "$CONFIG_FILE" DOCOMATOR_ACCESS_CODE_HASH "$CREDENTIAL_HASH"
# Existing 0.6.2 installations may still need the legacy key only for rollback.
# New installations do not receive it.
if grep -q -E '^[[:space:]]*DOCOMATOR_ACCESS_PASSWORD_HASH=' "$CONFIG_FILE"; then
  replace_env_value "$CONFIG_FILE" DOCOMATOR_ACCESS_PASSWORD_HASH "$CREDENTIAL_HASH"
fi
replace_env_value "$CONFIG_FILE" DOCOMATOR_SESSION_SECRET "$SESSION_SECRET"
if [[ -z "$(read_env_value "$CONFIG_FILE" DOCOMATOR_SESSION_TTL_SECONDS)" ]]; then
  replace_env_value "$CONFIG_FILE" DOCOMATOR_SESSION_TTL_SECONDS "28800"
fi
chmod 0640 "$CONFIG_FILE"

DATA_DIR="$(read_env_value "$CONFIG_FILE" DOCOMATOR_DATA_DIR)"
[[ -n "$DATA_DIR" ]] || DATA_DIR="/var/lib/docomator"
DATABASE_PATH="$DATA_DIR/docomator.db"
if [[ -f "$DATABASE_PATH" ]]; then
  "$NODE_BIN" --input-type=module - "$DATABASE_PATH" "$CREDENTIAL_HASH" <<'NODE'
import { DatabaseSync } from "node:sqlite";
const databasePath=process.argv[2];
const credentialHash=process.argv[3];
const database=new DatabaseSync(databasePath);
try {
  // Historical names come from immutable migration 0031.
  const table=database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'shared_access_password'").get();
  if(table!==undefined){
    database.exec("BEGIN IMMEDIATE;");
    try{
      database.prepare("INSERT INTO shared_access_password (singleton, password_hash, configured_at) VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET password_hash = excluded.password_hash, configured_at = excluded.configured_at").run(credentialHash,new Date().toISOString());
      database.exec("COMMIT;");
    }catch(error){
      database.exec("ROLLBACK;");
      throw error;
    }
  }
} finally {
  database.close();
}
NODE
fi

if ((NO_RESTART == 0)) && command -v systemctl >/dev/null 2>&1; then
  systemctl restart docomator-api.service
  systemctl is-active --quiet docomator-api.service || \
    die "Код сохранён, но docomator-api.service не запустился. Проверьте journalctl -u docomator-api.service"
fi

printf '✅ Код доступа Оформлятора обновлён. Ранее открытые браузерные сессии закрыты.\n'
