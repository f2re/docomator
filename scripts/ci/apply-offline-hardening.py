from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, value: str) -> None:
    (ROOT / relative).write_text(value, encoding="utf-8")
    print(f"updated {relative}")


def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one occurrence, found {count}: {old[:180]!r}")
    return value.replace(old, new, 1)


# scripts/offline/lib.sh
lib = read("scripts/offline/lib.sh")
new_verify_package_set = r'''verify_os_package_set() (
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

'''
lib, count = re.subn(
    r"verify_os_package_set\(\) \(\n.*?\n\)\n\n(?=verify_target_os_package_profile\(\) \()",
    new_verify_package_set,
    lib,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError("lib.sh: verify_os_package_set block not found")

new_verify_target = r'''verify_target_os_package_profile() (
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

'''
lib, count = re.subn(
    r"verify_target_os_package_profile\(\) \(\n.*?\n\)\n\n(?=render_template\(\))",
    new_verify_target,
    lib,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError("lib.sh: verify_target_os_package_profile block not found")
write("scripts/offline/lib.sh", lib)


# scripts/offline/prepare-bundle.sh
prepare = read("scripts/offline/prepare-bundle.sh")
prepare = replace_once(
    prepare,
    'TARGET_ARCH="$(uname -m)"\nPREVIEW_PROFILE=""',
    'TARGET_ARCH="$(uname -m)"\nTARGET_PROFILE=""\nPREVIEW_PROFILE=""',
    "prepare target variable",
)
prepare = replace_once(
    prepare,
    '  --target-arch ARCH           x86_64 or aarch64 (default: current host)\n',
    '  --target-arch ARCH           x86_64 or aarch64 (default: current host)\n  --target-profile PROFILE      generic, debian or astra\n',
    "prepare usage",
)
prepare = replace_once(
    prepare,
    '    --target-arch) TARGET_ARCH="$2"; shift 2 ;;\n',
    '    --target-arch) TARGET_ARCH="$2"; shift 2 ;;\n    --target-profile) TARGET_PROFILE="$2"; shift 2 ;;\n',
    "prepare args",
)
prepare = replace_once(
    prepare,
    '[[ -n "$UX_ACCEPTANCE_PROFILE" ]] || die \\\n  "Укажите --with-ux-acceptance или --without-ux-acceptance; профиль UX-приёмки не выбирается неявно."\n',
    '[[ -n "$UX_ACCEPTANCE_PROFILE" ]] || die \\\n  "Укажите --with-ux-acceptance или --without-ux-acceptance; профиль UX-приёмки не выбирается неявно."\nif [[ -z "$TARGET_PROFILE" ]]; then\n  if [[ -n "$OS_PACKAGES_DIR" || "$PREVIEW_PROFILE" == "with" || "$UX_ACCEPTANCE_PROFILE" == "with" ]]; then\n    die "Для комплекта с пакетами ОС укажите --target-profile debian или --target-profile astra."\n  fi\n  TARGET_PROFILE="generic"\nfi\n[[ "$TARGET_PROFILE" == "generic" || "$TARGET_PROFILE" == "debian" || "$TARGET_PROFILE" == "astra" ]] || \\\n  die "Неподдерживаемый target-profile: $TARGET_PROFILE"\n',
    "prepare profile validation",
)
prepare = replace_once(
    prepare,
    '  SOURCE_DEB_ARCHITECTURE="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" DEB_ARCHITECTURE)"\n',
    '  SOURCE_OS_FAMILY="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" OS_FAMILY)"\n  SOURCE_DEB_ARCHITECTURE="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" DEB_ARCHITECTURE)"\n  [[ "$TARGET_PROFILE" != "generic" && "$SOURCE_OS_FAMILY" == "$TARGET_PROFILE" ]] || \\\n    die "--target-profile не совпадает с OS_FAMILY набора .deb"\n',
    "prepare source family",
)
prepare = replace_once(
    prepare,
    '  "$BUNDLE_DIR/payload/app/examples" \\\n',
    '  "$BUNDLE_DIR/payload/app/examples" \\\n  "$BUNDLE_DIR/payload/app/docs" \\\n',
    "prepare docs dir",
)
prepare = replace_once(
    prepare,
    'cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$ROOT_DIR/VERSION" \\\n  "$BUNDLE_DIR/payload/app/"\n',
    'cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$ROOT_DIR/VERSION" \\\n  "$ROOT_DIR/README.md" "$BUNDLE_DIR/payload/app/"\ncp -a "$ROOT_DIR/docs/." "$BUNDLE_DIR/payload/app/docs/"\n',
    "prepare copy docs",
)
prepare = replace_once(
    prepare,
    "      \\( -name '*.deb' -o -name 'manifest.sha256' -o -name 'packages.tsv' -o -name 'source-os.env' \\) \\\n",
    "      \\( -name '*.deb' -o -name 'manifest.sha256' -o -name 'packages.tsv' -o -name 'requested-packages.txt' -o -name 'source-os.env' \\) \\\n",
    "prepare os metadata copy",
)
prepare = replace_once(
    prepare,
    '  "$SCRIPT_DIR/verify-release.mjs" \\\n  "$BUNDLE_DIR/"\n',
    '  "$SCRIPT_DIR/verify-release.mjs" \\\n  "$SCRIPT_DIR/verify-target-profile.mjs" \\\n  "$BUNDLE_DIR/"\n',
    "prepare verifier copy",
)
prepare = replace_once(
    prepare,
    '  SOURCE_OS_ID="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" OS_ID)"\n',
    '  SOURCE_OS_FAMILY="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" OS_FAMILY)"\n  SOURCE_OS_ID="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" OS_ID)"\n',
    "prepare release source family",
)
prepare = replace_once(
    prepare,
    '  OS_PACKAGE_SOURCE_JSON="{\\"id\\":\\"$SOURCE_OS_ID\\",\\"versionId\\":\\"$SOURCE_OS_VERSION_ID\\",\\"architecture\\":\\"$SOURCE_DEB_ARCHITECTURE\\"}"\n',
    '  OS_PACKAGE_SOURCE_JSON="{\\"family\\":\\"$SOURCE_OS_FAMILY\\",\\"id\\":\\"$SOURCE_OS_ID\\",\\"versionId\\":\\"$SOURCE_OS_VERSION_ID\\",\\"architecture\\":\\"$SOURCE_DEB_ARCHITECTURE\\",\\"dependencyClosure\\":\\"full\\"}"\n',
    "prepare release source json",
)
prepare = replace_once(
    prepare,
    '  "name": "docomator",\n  "version": "$VERSION",\n',
    '  "name": "docomator",\n  "version": "$VERSION",\n  "bundleSchemaVersion": 2,\n  "targetProfile": "$TARGET_PROFILE",\n  "dependencyClosure": "$([[ "$OS_PACKAGES_INCLUDED" == "true" ]] && printf full || printf not-applicable)",\n',
    "prepare release fields",
)
write("scripts/offline/prepare-bundle.sh", prepare)


# scripts/offline/build-full-bundle.sh
builder = read("scripts/offline/build-full-bundle.sh")
builder = replace_once(
    builder,
    '  --target-arch "$TARGET_ARCH"\n',
    '  --target-arch "$TARGET_ARCH"\n  --target-profile "$TARGET"\n',
    "builder target profile",
)
builder = replace_once(
    builder,
    '[[ -f "$ARCHIVE" && -f "$CHECKSUM" ]] || \\\n  die "Сборщик завершился без ожидаемого архива или SHA-256."\n\ninfo "Полный offline bundle для $TARGET создан."\n',
    '[[ -f "$ARCHIVE" && -f "$CHECKSUM" ]] || \\\n  die "Сборщик завершился без ожидаемого архива или SHA-256."\n(\n  cd "$(dirname "$ARCHIVE")"\n  sha256sum --check --strict --quiet "$(basename "$CHECKSUM")"\n)\nARCHIVE_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/docomator-archive-check.XXXXXX")"\nTEMPORARY_DIRECTORY="$ARCHIVE_TEST_DIR"\nwhile IFS= read -r member; do\n  [[ -n "$member" && "$member" != /* && "$member" != *$\'\\n\'* && "$member" != *$\'\\r\'* ]] || \\\n    die "Архив содержит небезопасное имя."\n  case "/$member/" in\n    */../*) die "Архив содержит выход за пределы каталога." ;;\n  esac\ndone < <(tar -tzf "$ARCHIVE")\ntar -xzf "$ARCHIVE" -C "$ARCHIVE_TEST_DIR"\nEXTRACTED_BUNDLE="$ARCHIVE_TEST_DIR/docomator-${VERSION}-linux-${NODE_ARCH}"\n[[ -d "$EXTRACTED_BUNDLE" ]] || die "После распаковки не найден корень комплекта."\n"$EXTRACTED_BUNDLE/verify-bundle.sh" "$EXTRACTED_BUNDLE"\n\ninfo "Полный offline bundle для $TARGET создан и повторно проверен после распаковки."\n',
    "builder archive verification",
)
write("scripts/offline/build-full-bundle.sh", builder)


# scripts/offline/verify-bundle.sh
verify = read("scripts/offline/verify-bundle.sh")
verify = replace_once(
    verify,
    '[[ -f "$BUNDLE_ROOT/verify-release.mjs" ]] || die "В комплекте отсутствует проверка release metadata"\n',
    '[[ -f "$BUNDLE_ROOT/verify-release.mjs" ]] || die "В комплекте отсутствует проверка release metadata"\n[[ -f "$BUNDLE_ROOT/verify-target-profile.mjs" ]] || die "В комплекте отсутствует проверка target-профиля"\n',
    "verify target verifier",
)
verify = replace_once(
    verify,
    '[[ -f "$BUNDLE_ROOT/payload/config/docomator.env.example" ]] || \\\n  die "В комплекте отсутствует шаблон настроек"\n',
    '[[ -f "$BUNDLE_ROOT/payload/config/docomator.env.example" ]] || \\\n  die "В комплекте отсутствует шаблон настроек"\n[[ -f "$BUNDLE_ROOT/payload/app/README.md" ]] || die "В комплекте отсутствует README"\n[[ -f "$BUNDLE_ROOT/payload/app/docs/README.md" ]] || die "В комплекте отсутствует индекс документации"\n[[ -f "$BUNDLE_ROOT/payload/app/docs/OFFLINE_DEPLOYMENT.md" ]] || die "В комплекте отсутствует руководство автономной установки"\n[[ -f "$BUNDLE_ROOT/payload/app/docs/ENTITY_MODEL_AND_IMPORT.md" ]] || die "В комплекте отсутствует описание произвольных объектов"\n[[ -f "$BUNDLE_ROOT/payload/app/apps/api/ui/entity-workspace.js" ]] || die "В комплекте отсутствует интерфейс произвольных объектов"\n[[ -f "$BUNDLE_ROOT/payload/app/apps/api/ui/generic-template-entities.js" ]] || die "В комплекте отсутствует выбор типа объектов шаблона"\n[[ -f "$BUNDLE_ROOT/payload/app/apps/api/ui/generic-document-generation.js" ]] || die "В комплекте отсутствует выпуск документов по объектам"\n',
    "verify docs and ui",
)
verify = replace_once(
    verify,
    '"$BUNDLE_ROOT/payload/runtime/node/bin/node" \\\n  "$BUNDLE_ROOT/verify-release.mjs" \\\n  "$BUNDLE_ROOT"\n',
    '"$BUNDLE_ROOT/payload/runtime/node/bin/node" \\\n  "$BUNDLE_ROOT/verify-release.mjs" \\\n  "$BUNDLE_ROOT"\n"$BUNDLE_ROOT/payload/runtime/node/bin/node" \\\n  "$BUNDLE_ROOT/verify-target-profile.mjs" \\\n  "$BUNDLE_ROOT"\n',
    "verify profile call",
)
write("scripts/offline/verify-bundle.sh", verify)


# package.json
package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package["scripts"]["check:runtime"] += " && node --check scripts/offline/verify-target-profile.mjs"
package["scripts"]["check:ui"] += (
    " && node --check apps/api/ui/entity-workspace.js"
    " && node --check apps/api/ui/generic-template-entities.js"
    " && node --check apps/api/ui/generic-document-generation.js"
)
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("updated package.json")


# scripts/offline/verify-bundle.test.mjs
verify_test = read("scripts/offline/verify-bundle.test.mjs")
verify_test = replace_once(
    verify_test,
    'const VERIFY_RELEASE = path.join(ROOT, "scripts/offline/verify-release.mjs");\n',
    'const VERIFY_RELEASE = path.join(ROOT, "scripts/offline/verify-release.mjs");\nconst VERIFY_TARGET_PROFILE = path.join(\n  ROOT,\n  "scripts/offline/verify-target-profile.mjs"\n);\n',
    "test verifier const",
)
verify_test = replace_once(
    verify_test,
    '    gitCommit: "test",\n    targetArchitecture:',
    '    gitCommit: "test",\n    bundleSchemaVersion: 2,\n    targetProfile: "generic",\n    dependencyClosure: "not-applicable",\n    targetArchitecture:',
    "test release metadata",
)
verify_test = replace_once(
    verify_test,
    '    writeFile(\n      path.join(packageRoot, "source-os.env"),\n      `OS_ID=debian\\nOS_VERSION_ID="12"\\nDEB_ARCHITECTURE=${debArchitecture}\\n`\n    ),\n',
    '    writeFile(\n      path.join(packageRoot, "requested-packages.txt"),\n      `${[...packageNames].sort().join("\\n")}\\n`\n    ),\n    writeFile(\n      path.join(packageRoot, "source-os.env"),\n      `OS_FAMILY=debian\\nOS_ID=debian\\nOS_VERSION_ID=12\\nDEB_ARCHITECTURE=${debArchitecture}\\nDEPENDENCY_CLOSURE=full\\nAPT_INSTALL_RECOMMENDS=false\\nREQUESTED_PACKAGES_SHA256=${createHash("sha256").update(`${[...packageNames].sort().join("\\n")}\\n`).digest("hex")}\\n`\n    ),\n',
    "test source metadata",
)
verify_test = replace_once(
    verify_test,
    '      previewEnabled: true,\n      osPackagesIncluded: true,\n',
    '      previewEnabled: true,\n      targetProfile: "debian",\n      dependencyClosure: "full",\n      osPackagesIncluded: true,\n',
    "test preview profile",
)
verify_test = replace_once(
    verify_test,
    '      osPackageSource: {\n        id: "debian",\n',
    '      osPackageSource: {\n        family: "debian",\n        id: "debian",\n',
    "test source family",
)
verify_test = replace_once(
    verify_test,
    '        architecture: debArchitecture\n      }\n',
    '        architecture: debArchitecture,\n        dependencyClosure: "full"\n      }\n',
    "test source closure",
)
verify_test = replace_once(
    verify_test,
    '    "payload/app/scripts/runtime/pilot-check.sh",\n',
    '    "payload/app/scripts/runtime/pilot-check.sh",\n    "payload/app/README.md",\n    "payload/app/docs/README.md",\n    "payload/app/docs/OFFLINE_DEPLOYMENT.md",\n    "payload/app/docs/ENTITY_MODEL_AND_IMPORT.md",\n    "payload/app/apps/api/ui/entity-workspace.js",\n    "payload/app/apps/api/ui/generic-template-entities.js",\n    "payload/app/apps/api/ui/generic-document-generation.js",\n',
    "test required payload",
)
verify_test = replace_once(
    verify_test,
    '  await copyFile(VERIFY_RELEASE, path.join(bundle, "verify-release.mjs"));\n',
    '  await copyFile(VERIFY_RELEASE, path.join(bundle, "verify-release.mjs"));\n  await copyFile(\n    VERIFY_TARGET_PROFILE,\n    path.join(bundle, "verify-target-profile.mjs")\n  );\n',
    "test copy target verifier",
)
write("scripts/offline/verify-bundle.test.mjs", verify_test)

print("offline hardening patches applied")
