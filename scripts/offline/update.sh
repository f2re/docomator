#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_operator_owned_bundle() {
  local root="$1"
  local entry owner_uid mode current sticky allowed_uid
  root="$(absolute_path "$root")"
  [[ -d "$root" ]] || die "Каталог автономного комплекта не найден: $root"

  allowed_uid="${SUDO_UID:-0}"
  [[ "$allowed_uid" =~ ^[0-9]+$ ]] || allowed_uid=0

  current="$root"
  while :; do
    owner_uid="$(stat -c '%u' -- "$current")" || \
      die "Не удалось проверить владельца пути комплекта: $current"
    mode="$(stat -c '%a' -- "$current")" || \
      die "Не удалось проверить режим пути комплекта: $current"
    [[ "$owner_uid" == "0" || "$owner_uid" == "$allowed_uid" ]] || \
      die "Путь комплекта должен принадлежать root или пользователю, запустившему sudo: $current"
    if (( (8#$mode & 8#022) != 0 )); then
      sticky=$((8#$mode & 8#1000))
      ((sticky != 0)) || \
        die "Путь комплекта доступен для записи другим пользователям: $current"
    fi
    [[ "$current" == "/" ]] && break
    current="$(dirname "$current")"
  done

  while IFS= read -r -d '' entry; do
    owner_uid="$(stat -c '%u' -- "$entry")" || \
      die "Не удалось проверить владельца объекта комплекта: $entry"
    [[ "$owner_uid" == "0" || "$owner_uid" == "$allowed_uid" ]] || \
      die "Объект комплекта принадлежит другому пользователю: $entry"
    if [[ ! -L "$entry" ]]; then
      mode="$(stat -c '%a' -- "$entry")" || \
        die "Не удалось проверить режим объекта комплекта: $entry"
      (( (8#$mode & 8#022) == 0 )) || \
        die "Комплект не должен быть доступен для записи группе или остальным: $entry"
    fi
  done < <(find "$root" -print0)
}

require_root
require_command flock
require_command stat

BUNDLE_ROOT="$SCRIPT_DIR"
arguments=("$@")
for ((index = 0; index < ${#arguments[@]}; index += 1)); do
  if [[ "${arguments[$index]}" == "--bundle-root" ]]; then
    ((index + 1 < ${#arguments[@]})) || die "После --bundle-root требуется каталог"
    BUNDLE_ROOT="${arguments[$((index + 1))]}"
    break
  fi
done
BUNDLE_ROOT="$(absolute_path "$BUNDLE_ROOT")"
if [[ "$(stat -c '%u' -- "$SCRIPT_DIR")" == "0" ]]; then
  require_trusted_bundle "$SCRIPT_DIR"
else
  require_operator_owned_bundle "$SCRIPT_DIR"
fi
if [[ "$BUNDLE_ROOT" != "$SCRIPT_DIR" ]]; then
  if [[ "$(stat -c '%u' -- "$BUNDLE_ROOT")" == "0" ]]; then
    require_trusted_bundle "$BUNDLE_ROOT"
  else
    require_operator_owned_bundle "$BUNDLE_ROOT"
  fi
fi
"$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"

LOCK_FILE="/run/lock/docomator-update.lock"
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || die "Another Оформлятор installation or update is running"

exec "$SCRIPT_DIR/install.sh" --upgrade "$@"
