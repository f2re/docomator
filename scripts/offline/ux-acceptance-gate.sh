#!/usr/bin/env bash
set -Eeuo pipefail
export PATH="/usr/sbin:/usr/bin:/sbin:/bin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  cat <<'USAGE'
Использование: ./ux-acceptance-gate.sh --output КАТАЛОГ [--base-url URL]

Запускает полный Playwright/axe-набор из проверенного автономного комплекта.
Команда выполняется обычным пользователем, не использует сеть вне локального
адреса Docomator и создаёт новый защищённый каталог свидетельств.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_trusted_bundle "$SCRIPT_DIR"
"$SCRIPT_DIR/verify-bundle.sh" "$SCRIPT_DIR"
verify_target_os_package_profile "$SCRIPT_DIR/payload/os-packages"

[[ "${EUID:-$(id -u)}" -ne 0 ]] || die \
  "UX-приёмку необходимо запускать обычным непривилегированным пользователем."

exec "$SCRIPT_DIR/payload/runtime/node/bin/node" \
  "$SCRIPT_DIR/ux-acceptance-gate.mjs" \
  "$@"
