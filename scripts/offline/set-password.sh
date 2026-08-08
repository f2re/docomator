#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

CONFIG_FILE="/etc/docomator/docomator.env"
NODE_BIN="/opt/docomator/current/runtime/node/bin/node"
PASSWORD_STDIN=0
NO_RESTART=0

usage() {
  cat <<'USAGE'
Использование: sudo set-password.sh [параметры]

Устанавливает или меняет общий пароль входа Docomator. В конфигурацию записывается
только scrypt-хэш; сам пароль не сохраняется. При первой настройке также создаётся
случайный секрет браузерных сессий.

Параметры:
  --config ФАЙЛ       файл /etc/docomator/docomator.env
  --node ФАЙЛ         встроенный node Docomator
  --password-stdin    прочитать пароль из stdin без повторного запроса
  --no-restart        не перезапускать docomator-api.service
  -h, --help          показать эту справку
USAGE
}

while (($# > 0)); do
  case "$1" in
    --config) CONFIG_FILE="$2"; shift 2 ;;
    --node) NODE_BIN="$2"; shift 2 ;;
    --password-stdin) PASSWORD_STDIN=1; shift ;;
    --no-restart) NO_RESTART=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

require_root
[[ -f "$CONFIG_FILE" ]] || die "Файл конфигурации не найден: $CONFIG_FILE"
[[ -x "$NODE_BIN" ]] || die "Node.js Docomator не найден: $NODE_BIN"

if ((PASSWORD_STDIN == 1)); then
  IFS= read -r PASSWORD || true
else
  printf 'Новый общий пароль Docomator: ' >&2
  IFS= read -r -s PASSWORD
  printf '\nПовторите пароль: ' >&2
  IFS= read -r -s PASSWORD_REPEAT
  printf '\n' >&2
  [[ "$PASSWORD" == "$PASSWORD_REPEAT" ]] || die "Пароли не совпадают"
  unset PASSWORD_REPEAT
fi

HASH="$({ printf '%s' "$PASSWORD"; } | "$NODE_BIN" --input-type=module -e '
  import { randomBytes, scryptSync } from "node:crypto";
  let password = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) password += chunk;
  const length = [...password].length;
  if (length < 12 || length > 512) {
    console.error("Пароль должен содержать от 12 до 512 символов.");
    process.exit(2);
  }
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  process.stdout.write([
    "scrypt-v1",
    "16384",
    "8",
    "1",
    salt.toString("base64url"),
    digest.toString("base64url")
  ].join(":"));
')"
unset PASSWORD

SESSION_SECRET="$(read_env_value "$CONFIG_FILE" DOCOMATOR_SESSION_SECRET)"
if [[ -z "$SESSION_SECRET" ]]; then
  SESSION_SECRET="$($NODE_BIN --input-type=module -e '
    import { randomBytes } from "node:crypto";
    process.stdout.write(randomBytes(48).toString("base64url"));
  ')"
fi

replace_env_value "$CONFIG_FILE" DOCOMATOR_ACCESS_PASSWORD_HASH "$HASH"
replace_env_value "$CONFIG_FILE" DOCOMATOR_SESSION_SECRET "$SESSION_SECRET"
if [[ -z "$(read_env_value "$CONFIG_FILE" DOCOMATOR_SESSION_TTL_SECONDS)" ]]; then
  replace_env_value "$CONFIG_FILE" DOCOMATOR_SESSION_TTL_SECONDS "28800"
fi

chmod 0640 "$CONFIG_FILE"

if ((NO_RESTART == 0)) && command -v systemctl >/dev/null 2>&1; then
  systemctl restart docomator-api.service
  systemctl is-active --quiet docomator-api.service || \
    die "Пароль сохранён, но docomator-api.service не запустился. Проверьте journalctl -u docomator-api.service"
fi

printf '✅ Общий пароль Docomator обновлён. Все ранее выданные сессии с прежним session secret остаются действительны до истечения срока; для немедленного сброса всех сессий смените DOCOMATOR_SESSION_SECRET.\n'
