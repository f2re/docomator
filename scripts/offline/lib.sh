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

verify_os_package_set() (
  set -Eeuo pipefail
  local package_root="$1"
  local require_libreoffice="${2:-0}"
  local validation_dir line sha256 package version architecture filename extra
  local actual_package actual_version actual_architecture source_os_family source_os_id
  local source_os_version_id source_deb_architecture dependency_closure
  local install_recommends requested_packages_sha256 requested_package

  require_command cmp
  require_command dpkg-deb
  require_command find
  require_command sed
  require_command sha256sum
  require_command sort

  [[ -d "$package_root" ]] || die "Не найден каталог пакетов ОС: $package_root"
  for metadata in manifest.sha256 packages.tsv requested-packages.txt source-os.env; do
    [[ -f "$package_root/$metadata" && ! -L "$package_root/$metadata" ]] || \
      die "В наборе пакетов ОС отсутствует $metadata"
  done

  source_os_family="$(read_env_value "$package_root/source-os.env" OS_FAMILY)"
  source_os_id="$(read_env_value "$package_root/source-os.env" OS_ID)"
  source_os_version_id="$(read_env_value "$package_root/source-os.env" OS_VERSION_ID)"
  source_deb_architecture="$(read_env_value "$package_root/source-os.env" DEB_ARCHITECTURE)"
  dependency_closure="$(read_env_value "$package_root/source-os.env" DEPENDENCY_CLOSURE)"
  install_recommends="$(read_env_value "$package_root/source-os.env" APT_INSTALL_RECOMMENDS)"
  requested_packages_sha256="$(read_env_value "$package_root/source-os.env" REQUESTED_PACKAGES_SHA256)"
  [[ "$source_os_family" == "debian" || "$source_os_family" == "astra" ]] || \
    die "Некорректный OS_FAMILY в source-os.env"
  [[ "$source_os_id" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || \
    die "Некорректный OS_ID в source-os.env"
  [[ "$source_os_version_id" =~ ^[A-Za-z0-9][A-Za-z0-9.+:~_-]*$ ]] || \
    die "Некорректный OS_VERSION_ID в source-os.env"
  [[ "$source_deb_architecture" =~ ^[a-z0-9][a-z0-9-]*$ ]] || \
    die "Некорректный DEB_ARCHITECTURE в source-os.env"
  [[ "$dependency_closure" == "full" ]] || \
    die "Набор .deb не подтверждает полное замыкание зависимостей"
  [[ "$install_recommends" == "false" ]] || \
    die "Набор .deb должен быть рассчитан без необязательных recommends"
  [[ "$requested_packages_sha256" =~ ^[a-f0-9]{64}$ ]] || \
    die "Некорректный REQUESTED_PACKAGES_SHA256 в source-os.env"
  [[ "$(sha256_of "$package_root/requested-packages.txt")" == "$requested_packages_sha256" ]] || \
    die "Checksum requested-packages.txt не совпадает с source-os.env"

  if find "$package_root" -mindepth 1 ! -type d ! -type f -print -quit | grep -q .; then
    die "В наборе пакетов ОС найден запрещённый объект"
  fi
  if find "$package_root" -mindepth 2 ! -type d -print -quit | grep -q .; then
    die "Файлы пакетов ОС должны находиться непосредственно в корне набора"
  fi

  validation_dir="$(mktemp -d "/tmp/docomator-os-packages.XXXXXX")"
  trap 'rm -rf "$validation_dir"' EXIT

  (
    cd "$package_root"
    find . -maxdepth 1 -type f -print | LC_ALL=C sort > "$validation_dir/actual-files"
    find . -maxdepth 1 -type f -name '*.deb' -print | LC_ALL=C sort > "$validation_dir/actual-debs"
  )
  [[ -s "$validation_dir/actual-debs" ]] || die "В наборе пакетов ОС нет файлов .deb"
  {
    printf '%s\n' './manifest.sha256' './packages.tsv' './requested-packages.txt' './source-os.env'
    cat "$validation_dir/actual-debs"
  } | LC_ALL=C sort > "$validation_dir/expected-files"
  cmp -s "$validation_dir/expected-files" "$validation_dir/actual-files" || \
    die "Состав набора пакетов ОС содержит лишние или неподдерживаемые файлы"

  sed -E 's/^[a-f0-9]{64}  //' "$package_root/manifest.sha256" \
    > "$validation_dir/manifest-debs"
  cmp -s "$validation_dir/actual-debs" "$validation_dir/manifest-debs" || \
    die "Пути в manifest пакетов ОС не совпадают с точным набором .deb"
  (
    cd "$package_root"
    sha256sum --check --strict --quiet manifest.sha256
  )

  : > "$validation_dir/requested-normalized"
  while IFS= read -r requested_package; do
    [[ -n "$requested_package" ]] || die "Пустая строка запрещена в requested-packages.txt"
    [[ "$requested_package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || \
      die "Некорректное имя в requested-packages.txt: $requested_package"
    printf '%s\n' "$requested_package" >> "$validation_dir/requested-normalized"
  done < "$package_root/requested-packages.txt"
  [[ -s "$validation_dir/requested-normalized" ]] || \
    die "requested-packages.txt не содержит пакетов"
  LC_ALL=C sort -u "$validation_dir/requested-normalized" > "$validation_dir/requested-sorted"
  cmp -s "$validation_dir/requested-normalized" "$validation_dir/requested-sorted" || \
    die "requested-packages.txt должен быть отсортирован и не содержать повторов"

  IFS= read -r line < "$package_root/packages.tsv" || true
  [[ "$line" == $'sha256\tpackage\tversion\tarchitecture\tfilename' ]] || \
    die "Некорректный заголовок packages.tsv"
  : > "$validation_dir/inventory-debs"
  : > "$validation_dir/package-names"
  while IFS=$'\t' read -r sha256 package version architecture filename extra; do
    [[ -n "$sha256$package$version$architecture$filename$extra" ]] || \
      die "Пустая строка запрещена в packages.tsv"
    [[ -z "$extra" && "$sha256" =~ ^[a-f0-9]{64}$ ]] || \
      die "Некорректная строка packages.tsv"
    [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || \
      die "Некорректное имя пакета в packages.tsv: $package"
    [[ "$version" != *$'\t'* && "$version" != *$'\n'* && -n "$version" ]] || \
      die "Некорректная версия пакета в packages.tsv: $package"
    [[ "$architecture" =~ ^[a-z0-9][a-z0-9-]*$ ]] || \
      die "Некорректная архитектура пакета в packages.tsv: $package"
    [[ "$filename" =~ ^[A-Za-z0-9][A-Za-z0-9.+:~_-]*\.deb$ ]] || \
      die "Некорректное имя файла в packages.tsv: $filename"
    [[ -f "$package_root/$filename" && ! -L "$package_root/$filename" ]] || \
      die "Файл из packages.tsv отсутствует: $filename"
    [[ "$(sha256_of "$package_root/$filename")" == "$sha256" ]] || \
      die "Checksum packages.tsv не совпадает: $filename"

    actual_package="$(dpkg-deb -f "$package_root/$filename" Package)" || \
      die "Не удалось прочитать имя Debian-пакета: $filename"
    actual_version="$(dpkg-deb -f "$package_root/$filename" Version)" || \
      die "Не удалось прочитать версию Debian-пакета: $filename"
    actual_architecture="$(dpkg-deb -f "$package_root/$filename" Architecture)" || \
      die "Не удалось прочитать архитектуру Debian-пакета: $filename"
    [[ "$actual_package" == "$package" && "$actual_version" == "$version" && \
       "$actual_architecture" == "$architecture" ]] || \
      die "Метаданные Debian-пакета не совпадают с packages.tsv: $filename"
    [[ "$architecture" == "all" || "$architecture" == "$source_deb_architecture" ]] || \
      die "Архитектура Debian-пакета не совпадает с source-os.env: $filename"
    printf './%s\n' "$filename" >> "$validation_dir/inventory-debs"
    printf '%s\n' "$package" >> "$validation_dir/package-names"
  done < <(tail -n +2 "$package_root/packages.tsv")

  cmp -s "$validation_dir/actual-debs" "$validation_dir/inventory-debs" || \
    die "Inventory packages.tsv не совпадает с точным набором .deb"
  if [[ "$(LC_ALL=C sort "$validation_dir/package-names" | uniq -d | head -n 1)" != "" ]]; then
    die "В наборе пакетов ОС обнаружено несколько версий одного пакета"
  fi
  while IFS= read -r requested_package; do
    grep -Fx "$requested_package" "$validation_dir/package-names" >/dev/null || \
      die "В полном наборе отсутствует запрошенный пакет: $requested_package"
  done < "$package_root/requested-packages.txt"

  if ((require_libreoffice == 1)); then
    for package in libreoffice-core libreoffice-writer libreoffice-calc; do
      grep -Fx "$package" "$validation_dir/package-names" >/dev/null || \
        die "Для preview-профиля отсутствует обязательный пакет: $package"
    done
  fi
)

verify_target_os_package_profile() (
  set -Eeuo pipefail
  local package_root="$1"
  local os_release_file="${2:-/etc/os-release}"
  local target_architecture="${3:-}"
  local source_os_family source_os_id source_os_version_id source_architecture
  local target_os_family target_os_id target_os_version_id target_os_name
  local target_os_pretty_name target_os_id_like target_description

  [[ -f "$package_root/source-os.env" ]] || \
    die "В наборе пакетов ОС отсутствует source-os.env"
  [[ -f "$os_release_file" ]] || \
    die "Не найден доверенный файл сведений о целевой ОС: $os_release_file"

  source_os_family="$(read_env_value "$package_root/source-os.env" OS_FAMILY)"
  source_os_id="$(read_env_value "$package_root/source-os.env" OS_ID)"
  source_os_version_id="$(read_env_value "$package_root/source-os.env" OS_VERSION_ID)"
  source_architecture="$(read_env_value "$package_root/source-os.env" DEB_ARCHITECTURE)"
  target_os_id="$(sed -n -E 's/^ID="?([^"[:space:]]+)"?$/\1/p' "$os_release_file" | head -n 1)"
  target_os_version_id="$(sed -n -E 's/^VERSION_ID="?([^"[:space:]]+)"?$/\1/p' "$os_release_file" | head -n 1)"
  target_os_name="$(sed -n -E 's/^NAME="?(.*)"?$/\1/p' "$os_release_file" | head -n 1 | sed -E 's/^"|"$//g')"
  target_os_pretty_name="$(sed -n -E 's/^PRETTY_NAME="?(.*)"?$/\1/p' "$os_release_file" | head -n 1 | sed -E 's/^"|"$//g')"
  target_os_id_like="$(sed -n -E 's/^ID_LIKE="?(.*)"?$/\1/p' "$os_release_file" | head -n 1 | sed -E 's/^"|"$//g')"
  target_description="${target_os_id,,} ${target_os_name,,} ${target_os_pretty_name,,} ${target_os_id_like,,}"
  if [[ "$target_description" == *astra* ]]; then
    target_os_family="astra"
  elif [[ "$target_os_id" == "debian" || " ${target_os_id_like,,} " == *" debian "* ]]; then
    target_os_family="debian"
  else
    die "Целевая ОС не относится к поддерживаемым Debian/Astra Linux"
  fi
  if [[ -z "$target_architecture" ]]; then
    require_command dpkg
    target_architecture="$(dpkg --print-architecture)"
  fi

  [[ "$source_os_family" == "debian" || "$source_os_family" == "astra" ]] || \
    die "Некорректный OS_FAMILY набора пакетов"
  [[ "$target_os_id" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || \
    die "Некорректный ID целевой ОС"
  [[ "$target_os_version_id" =~ ^[A-Za-z0-9][A-Za-z0-9.+:~_-]*$ ]] || \
    die "Некорректный VERSION_ID целевой ОС"
  [[ "$target_architecture" =~ ^[a-z0-9][a-z0-9-]*$ ]] || \
    die "Некорректная архитектура целевой ОС"
  [[ "$target_os_family" == "$source_os_family" && \
     "$target_os_id" == "$source_os_id" && \
     "$target_os_version_id" == "$source_os_version_id" && \
     "$target_architecture" == "$source_architecture" ]] || \
    die "Целевая ОС не совпадает с профилем пакетов: требуется ${source_os_family}/${source_os_id} ${source_os_version_id} ${source_architecture}, обнаружено ${target_os_family}/${target_os_id} ${target_os_version_id} ${target_architecture}"
)

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
