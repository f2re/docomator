#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  local level="$1"
  shift
  printf '[%s] %-6s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$level" "$*" >&2
}

info() { log ИНФО "$@"; }
warn() { log ВНИМ "$@"; }
die() { log ОШИБКА "$@"; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Не найдена обязательная команда: $1"
}

require_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "Команду необходимо выполнить с правами root."
}

absolute_path() {
  local target="$1"
  if [[ -d "$target" ]]; then
    (cd "$target" && pwd -P)
  else
    local directory
    directory="$(dirname "$target")"
    printf '%s/%s\n' "$(cd "$directory" && pwd -P)" "$(basename "$target")"
  fi
}

download_file() {
  local url="$1"
  local destination="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --retry 3 --output "$destination" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget --tries=3 --output-document="$destination" "$url"
  else
    die "На подключённом сервере подготовки требуется curl или wget."
  fi
}

sha256_of() {
  sha256sum "$1" | awk '{print $1}'
}

write_symlink_manifest() {
  local root="$1"
  local output="$2"
  local link relative target resolved
  root="$(absolute_path "$root")"
  : > "$output"
  while IFS= read -r -d '' link; do
    relative="${link#./}"
    target="$(readlink "$root/$relative")"
    if [[ "$relative" =~ [[:cntrl:]] || "$target" =~ [[:cntrl:]] || \
          "$target" == /* ]]; then
      die "В комплекте обнаружена небезопасная символическая ссылка: $relative"
    fi
    resolved="$(realpath "$root/$relative")" || \
      die "В комплекте обнаружена недействительная символическая ссылка: $relative"
    case "$resolved" in
      "$root"/*) ;;
      *) die "Символическая ссылка выходит за пределы комплекта: $relative" ;;
    esac
    printf '%s\t%s\n' "$relative" "$target" >> "$output"
  done < <(cd "$root" && find . -type l -print0 | LC_ALL=C sort -z)
}

require_trusted_bundle() {
  local root="$1"
  local entry ownership mode current sticky
  root="$(absolute_path "$root")"
  [[ -d "$root" ]] || die "Каталог автономного комплекта не найден: $root"

  current="$root"
  while :; do
    ownership="$(stat -c '%u:%g' -- "$current")" || \
      die "Не удалось проверить владельца пути комплекта: $current"
    mode="$(stat -c '%a' -- "$current")" || \
      die "Не удалось проверить режим пути комплекта: $current"
    [[ "$ownership" == "0:0" ]] || \
      die "Родительский путь комплекта должен принадлежать root:root: $current"
    if (( (8#$mode & 8#022) != 0 )); then
      sticky=$((8#$mode & 8#1000))
      ((sticky != 0)) || \
        die "Родительский путь комплекта доступен для подмены: $current"
    fi
    [[ "$current" == "/" ]] && break
    current="$(dirname "$current")"
  done

  while IFS= read -r -d '' entry; do
    ownership="$(stat -c '%u:%g' -- "$entry")" || \
      die "Не удалось проверить владельца объекта комплекта: $entry"
    [[ "$ownership" == "0:0" ]] || \
      die "Перед установкой комплект должен принадлежать root:root: $entry"
    if [[ ! -L "$entry" ]]; then
      mode="$(stat -c '%a' -- "$entry")" || \
        die "Не удалось проверить режим объекта комплекта: $entry"
      (( (8#$mode & 8#022) == 0 )) || \
        die "Комплект не должен быть доступен для записи группе или остальным: $entry"
    fi
  done < <(find "$root" -print0)
}

random_secret() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

read_env_value() {
  local file="$1"
  local key="$2"
  local value
  value="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 | cut -d= -f2- || true)"
  printf '%s' "$value"
}

replace_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\&|]/\\&/g')"
  if grep -q -E "^[[:space:]]*${key}=" "$file"; then
    sed -i -E "s|^[[:space:]]*${key}=.*$|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

render_template() {
  local source="$1"
  local destination="$2"
  local install_root="$3"
  local data_dir="$4"
  local config_dir="$5"
  local user="$6"
  local group="$7"

  sed \
    -e "s|@DOCOMATOR_INSTALL_ROOT@|${install_root//|/\\|}|g" \
    -e "s|@DOCOMATOR_DATA_DIR@|${data_dir//|/\\|}|g" \
    -e "s|@DOCOMATOR_CONFIG_DIR@|${config_dir//|/\\|}|g" \
    -e "s|@DOCOMATOR_USER@|${user//|/\\|}|g" \
    -e "s|@DOCOMATOR_GROUP@|${group//|/\\|}|g" \
    "$source" > "$destination"
}

service_exists() {
  systemctl list-unit-files "$1" --no-legend 2>/dev/null | grep -q "^$1"
}

stop_docomator_services() {
  if ! command -v systemctl >/dev/null 2>&1; then
    return 0
  fi
  systemctl stop docomator-backup.timer docomator-backup.service \
    docomator-worker.service docomator-api.service docomator-llm.service \
    2>/dev/null || true
}
