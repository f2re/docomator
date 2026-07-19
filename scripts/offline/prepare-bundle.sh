#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

VERSION="$(<"$ROOT_DIR/VERSION")"
NODE_VERSION="$(<"$ROOT_DIR/.node-version")"
OUTPUT_DIR="$ROOT_DIR/offline-bundles"
NODE_RUNTIME_DIR=""
NODE_ARCHIVE=""
NODE_SHA256=""
LLAMA_SERVER=""
MODEL_FILE=""
OS_PACKAGES_DIR=""
TARGET_ARCH="$(uname -m)"
PREVIEW_PROFILE=""
UX_ACCEPTANCE_PROFILE=""
UX_CHROMIUM_PACKAGE=""
UX_CHROMIUM_BIN=""
UX_SOURCE_COMMIT=""
SKIP_TESTS=0
INCLUDE_SOURCES=0
WITHOUT_LLM=0
FORCE=0

usage() {
  cat <<'USAGE'
Использование: scripts/offline/prepare-bundle.sh [параметры]

Создаёт самодостаточный автономный комплект на подключённом эталонном сервере.
Сервер подготовки должен иметь ту же архитектуру процессора и совместимую glibc,
что и целевой сервер Debian/Astra Linux.

Параметры:
  --version VERSION            Release version (default: VERSION file)
  --output DIR                 Output directory
  --node-version VERSION       Official Node.js version to download
  --node-runtime-dir DIR       Use an already unpacked Node.js runtime
  --node-archive FILE          Use a local official Node.js .tar.xz archive
  --node-sha256 SHA256         Expected checksum for --node-archive
  --target-arch ARCH           x86_64 or aarch64 (default: current host)
  --llama-server FILE          Prebuilt target-compatible llama-server binary
  --model FILE                 GGUF model to include
  --without-llm                Explicitly create a bundle without LLM assets
  --with-preview               Include and require the verified LibreOffice package set
  --without-preview            Explicitly create a bundle with PDF preview disabled
  --with-ux-acceptance         Include the offline Playwright/axe acceptance kit
  --without-ux-acceptance      Explicitly omit the acceptance kit
  --ux-chromium-package NAME   Chromium package in the verified .deb set (default: chromium)
  --ux-chromium-bin PATH       Absolute target Chromium path (default: /usr/bin/chromium)
  --os-packages-dir DIR        Verified directory produced by collect-os-packages.sh
  --include-sources            Keep TypeScript sources in the application payload
  --skip-tests                 Skip npm run check (not recommended)
  --force                      Replace an existing bundle for the same version
  -h, --help                   Show this help
USAGE
}

while (($# > 0)); do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --node-version) NODE_VERSION="$2"; shift 2 ;;
    --node-runtime-dir) NODE_RUNTIME_DIR="$2"; shift 2 ;;
    --node-archive) NODE_ARCHIVE="$2"; shift 2 ;;
    --node-sha256) NODE_SHA256="$2"; shift 2 ;;
    --target-arch) TARGET_ARCH="$2"; shift 2 ;;
    --llama-server) LLAMA_SERVER="$2"; shift 2 ;;
    --model) MODEL_FILE="$2"; shift 2 ;;
    --without-llm) WITHOUT_LLM=1; shift ;;
    --with-preview)
      [[ -z "$PREVIEW_PROFILE" ]] || die "Укажите только один preview-профиль"
      PREVIEW_PROFILE="with"
      shift
      ;;
    --without-preview)
      [[ -z "$PREVIEW_PROFILE" ]] || die "Укажите только один preview-профиль"
      PREVIEW_PROFILE="without"
      shift
      ;;
    --with-ux-acceptance)
      [[ -z "$UX_ACCEPTANCE_PROFILE" ]] || die "Укажите только один UX acceptance-профиль"
      UX_ACCEPTANCE_PROFILE="with"
      shift
      ;;
    --without-ux-acceptance)
      [[ -z "$UX_ACCEPTANCE_PROFILE" ]] || die "Укажите только один UX acceptance-профиль"
      UX_ACCEPTANCE_PROFILE="without"
      shift
      ;;
    --ux-chromium-package) UX_CHROMIUM_PACKAGE="$2"; shift 2 ;;
    --ux-chromium-bin) UX_CHROMIUM_BIN="$2"; shift 2 ;;
    --os-packages-dir) OS_PACKAGES_DIR="$2"; shift 2 ;;
    --include-sources) INCLUDE_SOURCES=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Неизвестный параметр: $1" ;;
  esac
done

require_command tar
require_command sha256sum
require_command find
require_command realpath
require_command sort
require_command xargs

[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || \
  die "Версия содержит запрещённые символы: $VERSION"
[[ -n "$PREVIEW_PROFILE" ]] || die \
  "Укажите --with-preview или --without-preview; preview-профиль не выбирается неявно."
[[ -n "$UX_ACCEPTANCE_PROFILE" ]] || die \
  "Укажите --with-ux-acceptance или --without-ux-acceptance; профиль UX-приёмки не выбирается неявно."

if [[ "$UX_ACCEPTANCE_PROFILE" == "with" ]]; then
  UX_CHROMIUM_PACKAGE="${UX_CHROMIUM_PACKAGE:-chromium}"
  UX_CHROMIUM_BIN="${UX_CHROMIUM_BIN:-/usr/bin/chromium}"
  [[ "$UX_CHROMIUM_PACKAGE" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || \
    die "Некорректное имя пакета Chromium: $UX_CHROMIUM_PACKAGE"
  [[ "$UX_CHROMIUM_BIN" =~ ^/[A-Za-z0-9._/+:-]+$ ]] || \
    die "Некорректный абсолютный путь Chromium: $UX_CHROMIUM_BIN"
else
  [[ -z "$UX_CHROMIUM_PACKAGE$UX_CHROMIUM_BIN" ]] || die \
    "Параметры Chromium разрешены только с --with-ux-acceptance."
fi
if [[ "$UX_ACCEPTANCE_PROFILE" == "with" ]]; then
  git -C "$ROOT_DIR" rev-parse --verify HEAD >/dev/null 2>&1 || \
    die "UX acceptance-профиль требует Git checkout с зафиксированным commit."
  UX_SOURCE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  [[ -z "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=normal)" ]] || \
    die "UX acceptance-профиль нельзя собирать из рабочего дерева с незакоммиченными изменениями."
fi

case "$TARGET_ARCH" in
  x86_64|amd64) NODE_ARCH="x64" ;;
  aarch64|arm64) NODE_ARCH="arm64" ;;
  *) die "Неподдерживаемая целевая архитектура: $TARGET_ARCH" ;;
esac

if [[ "$PREVIEW_PROFILE" == "with" && -z "$OS_PACKAGES_DIR" ]]; then
  die "Для --with-preview требуется --os-packages-dir с LibreOffice Writer/Calc."
fi
if [[ "$UX_ACCEPTANCE_PROFILE" == "with" && -z "$OS_PACKAGES_DIR" ]]; then
  die "Для --with-ux-acceptance требуется --os-packages-dir с Chromium."
fi
if [[ -n "$OS_PACKAGES_DIR" ]]; then
  OS_PACKAGES_DIR="$(absolute_path "$OS_PACKAGES_DIR")"
  verify_os_package_set \
    "$OS_PACKAGES_DIR" \
    "$([[ "$PREVIEW_PROFILE" == "with" ]] && printf 1 || printf 0)"
  SOURCE_DEB_ARCHITECTURE="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" DEB_ARCHITECTURE)"
  EXPECTED_DEB_ARCHITECTURE="$([[ "$NODE_ARCH" == "x64" ]] && printf amd64 || printf arm64)"
  [[ "$SOURCE_DEB_ARCHITECTURE" == "$EXPECTED_DEB_ARCHITECTURE" ]] || \
    die "Архитектура набора .deb не совпадает с --target-arch"
  if [[ "$UX_ACCEPTANCE_PROFILE" == "with" ]]; then
    UX_CHROMIUM_PACKAGE_VERSION="$(awk -F '\t' -v package="$UX_CHROMIUM_PACKAGE" \
      'NR > 1 && $2 == package { print $3 }' "$OS_PACKAGES_DIR/packages.tsv")"
    [[ "$UX_CHROMIUM_PACKAGE_VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9.+:~_-]*$ ]] || \
      die "В наборе .deb отсутствует единственный пакет Chromium: $UX_CHROMIUM_PACKAGE"
  fi
fi

if ((WITHOUT_LLM == 0)); then
  [[ -n "$LLAMA_SERVER" && -n "$MODEL_FILE" ]] || die \
    "Укажите одновременно --llama-server и --model либо явно используйте --without-llm."
  [[ -x "$LLAMA_SERVER" || -f "$LLAMA_SERVER" ]] || die "Не найден llama-server: $LLAMA_SERVER"
  [[ -f "$MODEL_FILE" ]] || die "Не найдена модель GGUF: $MODEL_FILE"
  MODEL_BASENAME="$(basename "$MODEL_FILE")"
  [[ "$MODEL_BASENAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || \
    die "Имя файла модели содержит запрещённые символы: $MODEL_BASENAME"
fi

OUTPUT_DIR="$(mkdir -p "$OUTPUT_DIR" && absolute_path "$OUTPUT_DIR")"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/docomator-bundle.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

NODE_STAGE="$WORK_DIR/node-runtime"
mkdir -p "$NODE_STAGE"

if [[ -n "$NODE_RUNTIME_DIR" ]]; then
  [[ -x "$NODE_RUNTIME_DIR/bin/node" ]] || die "Invalid Node.js runtime directory: $NODE_RUNTIME_DIR"
  info "Using Node.js runtime from $NODE_RUNTIME_DIR"
  cp -a "$NODE_RUNTIME_DIR/." "$NODE_STAGE/"
else
  ARCHIVE_NAME="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  if [[ -z "$NODE_ARCHIVE" ]]; then
    NODE_ARCHIVE="$WORK_DIR/$ARCHIVE_NAME"
    CHECKSUM_FILE="$WORK_DIR/SHASUMS256.txt"
    info "Downloading official Node.js v$NODE_VERSION runtime"
    download_file "https://nodejs.org/dist/v${NODE_VERSION}/${ARCHIVE_NAME}" "$NODE_ARCHIVE"
    download_file "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" "$CHECKSUM_FILE"
    EXPECTED="$(awk -v file="$ARCHIVE_NAME" '$2 == file {print $1}' "$CHECKSUM_FILE")"
    [[ -n "$EXPECTED" ]] || die "Node.js checksum was not found in SHASUMS256.txt"
  else
    NODE_ARCHIVE="$(absolute_path "$NODE_ARCHIVE")"
    [[ -f "$NODE_ARCHIVE" ]] || die "Node.js archive not found: $NODE_ARCHIVE"
    EXPECTED="$NODE_SHA256"
    [[ -n "$EXPECTED" ]] || die "--node-sha256 is required with --node-archive"
  fi

  ACTUAL="$(sha256_of "$NODE_ARCHIVE")"
  [[ "$ACTUAL" == "$EXPECTED" ]] || die "Node.js archive checksum mismatch"
  tar -xJf "$NODE_ARCHIVE" -C "$NODE_STAGE" --strip-components=1
fi

BUNDLED_NODE="$NODE_STAGE/bin/node"
BUNDLED_NPM="$NODE_STAGE/bin/npm"
[[ -x "$BUNDLED_NODE" && -x "$BUNDLED_NPM" ]] || die "Node.js runtime is incomplete"
ACTUAL_NODE_VERSION="$($BUNDLED_NODE --version)"
[[ "$ACTUAL_NODE_VERSION" == "v$NODE_VERSION" ]] || warn \
  "Requested Node.js v$NODE_VERSION, runtime reports $ACTUAL_NODE_VERSION"

info "Installing dependencies and building with $ACTUAL_NODE_VERSION"
(
  cd "$ROOT_DIR"
  PATH="$NODE_STAGE/bin:$PATH" "$BUNDLED_NPM" ci
  if ((SKIP_TESTS == 0)); then
    PATH="$NODE_STAGE/bin:$PATH" "$BUNDLED_NPM" run check
  else
    PATH="$NODE_STAGE/bin:$PATH" "$BUNDLED_NPM" run clean
    PATH="$NODE_STAGE/bin:$PATH" "$BUNDLED_NPM" run build
  fi
)

info "Проверяем воспроизводимость и безопасность учебных примеров"
(
  cd "$ROOT_DIR"
  PATH="$NODE_STAGE/bin:$PATH" "$BUNDLED_NPM" run check:examples
)

GIT_COMMIT="unknown"
if git -C "$ROOT_DIR" rev-parse --verify HEAD >/dev/null 2>&1; then
  GIT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
fi
if [[ "$UX_ACCEPTANCE_PROFILE" == "with" ]]; then
  [[ "$(git -C "$ROOT_DIR" rev-parse HEAD)" == "$UX_SOURCE_COMMIT" ]] || \
    die "HEAD изменился во время сборки; UX acceptance-комплект не создан."
  [[ -z "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=normal)" ]] || \
    die "Сборка или lifecycle-скрипт изменили Git checkout; UX acceptance-комплект не создан."
  [[ "$GIT_COMMIT" =~ ^([a-f0-9]{40}|[a-f0-9]{64})$ ]] || \
    die "UX acceptance-профиль можно собрать только из зафиксированного Git commit."
fi

BUNDLE_NAME="docomator-${VERSION}-linux-${NODE_ARCH}"
BUNDLE_DIR="$OUTPUT_DIR/$BUNDLE_NAME"
ARCHIVE_PATH="$OUTPUT_DIR/${BUNDLE_NAME}.tar.gz"
ARCHIVE_CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"

if [[ -e "$BUNDLE_DIR" || -e "$ARCHIVE_PATH" || -e "$ARCHIVE_CHECKSUM_PATH" ]]; then
  ((FORCE == 1)) || die "Bundle already exists; pass --force to replace it"
  rm -rf "$BUNDLE_DIR" "$ARCHIVE_PATH" "$ARCHIVE_CHECKSUM_PATH"
fi

mkdir -p \
  "$BUNDLE_DIR/payload/app/apps/api" \
  "$BUNDLE_DIR/payload/app/apps/worker" \
  "$BUNDLE_DIR/payload/app/packages/config" \
  "$BUNDLE_DIR/payload/app/packages/contracts" \
  "$BUNDLE_DIR/payload/app/packages/storage" \
  "$BUNDLE_DIR/payload/app/packages/document-intake" \
  "$BUNDLE_DIR/payload/app/packages/template-compiler" \
  "$BUNDLE_DIR/payload/app/scripts/runtime" \
  "$BUNDLE_DIR/payload/app/scripts/ci" \
  "$BUNDLE_DIR/payload/app/examples" \
  "$BUNDLE_DIR/payload/runtime/node" \
  "$BUNDLE_DIR/payload/runtime/llama" \
  "$BUNDLE_DIR/payload/models" \
  "$BUNDLE_DIR/payload/deploy/systemd" \
  "$BUNDLE_DIR/payload/config" \
  "$BUNDLE_DIR/payload/os-packages"

if [[ "$UX_ACCEPTANCE_PROFILE" == "with" ]]; then
  mkdir -p \
    "$BUNDLE_DIR/payload/acceptance/ux/tests/e2e" \
    "$BUNDLE_DIR/payload/acceptance/ux/node_modules/@playwright" \
    "$BUNDLE_DIR/payload/acceptance/ux/node_modules/@axe-core"
fi

cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$ROOT_DIR/VERSION" \
  "$BUNDLE_DIR/payload/app/"
cp -a "$ROOT_DIR/migrations" "$BUNDLE_DIR/payload/app/"
cp -a "$ROOT_DIR/scripts/runtime/." "$BUNDLE_DIR/payload/app/scripts/runtime/"
cp "$ROOT_DIR/scripts/ci/release-gate.mjs" \
  "$ROOT_DIR/scripts/ci/release-gate-crash-worker.mjs" \
  "$ROOT_DIR/scripts/ci/libreoffice-release-gate.mjs" \
  "$BUNDLE_DIR/payload/app/scripts/ci/"

for workspace in apps/api apps/worker packages/config packages/contracts packages/storage packages/document-intake packages/template-compiler; do
  destination="$BUNDLE_DIR/payload/app/$workspace"
  cp "$ROOT_DIR/$workspace/package.json" "$destination/"
  cp -a "$ROOT_DIR/$workspace/dist" "$destination/"
  if ((INCLUDE_SOURCES == 1)); then
    cp -a "$ROOT_DIR/$workspace/src" "$destination/"
    cp "$ROOT_DIR/$workspace/tsconfig.json" "$destination/"
  fi
done

cp -a "$ROOT_DIR/apps/api/ui" "$BUNDLE_DIR/payload/app/apps/api/"

if [[ "$UX_ACCEPTANCE_PROFILE" == "with" ]]; then
  UX_E2E_FILES=(
    "README.md"
    "accessibility-audit.spec.mjs"
    "bulk-import.spec.mjs"
    "employee-card.spec.mjs"
    "fixtures/docomator-api.mjs"
    "fixtures/test.mjs"
    "navigation-and-accessibility.spec.mjs"
    "operation-center.spec.mjs"
    "pages/docomator-page.mjs"
    "playwright.config.mjs"
    "reporters/axe-json-reporter.mjs"
    "template-and-generation.spec.mjs"
    "visual-artifacts.spec.mjs"
  )
  for relative in "${UX_E2E_FILES[@]}"; do
    source_file="$ROOT_DIR/tests/e2e/$relative"
    [[ -f "$source_file" && ! -L "$source_file" ]] || \
      die "Файл UX acceptance-набора отсутствует или является ссылкой: $relative"
    destination="$BUNDLE_DIR/payload/acceptance/ux/tests/e2e/$relative"
    mkdir -p "$(dirname "$destination")"
    cp "$source_file" "$destination"
  done

  cp -a "$ROOT_DIR/node_modules/@playwright/test" \
    "$BUNDLE_DIR/payload/acceptance/ux/node_modules/@playwright/"
  cp -a "$ROOT_DIR/node_modules/@axe-core/playwright" \
    "$BUNDLE_DIR/payload/acceptance/ux/node_modules/@axe-core/"
  for package in playwright playwright-core axe-core; do
    cp -a "$ROOT_DIR/node_modules/$package" \
      "$BUNDLE_DIR/payload/acceptance/ux/node_modules/"
  done
fi

EXAMPLE_FILES=(
  "README.md"
  "manifest.sha256"
  "data/employees.csv"
  "fixtures/header-field.docx"
  "fixtures/rejected/macro-part.docx"
  "fixtures/scalar-fields.xlsx"
  "templates/personal-card.docx"
  "templates/team-register.docx"
  "templates/team-register.xlsx"
  "expected/personal-card-filled.docx"
  "expected/team-register-filled.docx"
  "expected/team-register-filled.xlsx"
)
for relative in "${EXAMPLE_FILES[@]}"; do
  source_file="$ROOT_DIR/examples/$relative"
  [[ -f "$source_file" && ! -L "$source_file" ]] || \
    die "Учебный пример отсутствует или является ссылкой: $relative"
  destination="$BUNDLE_DIR/payload/app/examples/$relative"
  mkdir -p "$(dirname "$destination")"
  cp "$source_file" "$destination"
done

cp -a "$NODE_STAGE/." "$BUNDLE_DIR/payload/runtime/node/"
cp -a "$ROOT_DIR/deploy/systemd/." "$BUNDLE_DIR/payload/deploy/systemd/"
cp "$ROOT_DIR/config/docomator.env.example" "$BUNDLE_DIR/payload/config/"
replace_env_value \
  "$BUNDLE_DIR/payload/config/docomator.env.example" \
  DOCOMATOR_PREVIEW_ENABLED \
  "$([[ "$PREVIEW_PROFILE" == "with" ]] && printf true || printf false)"

if ((WITHOUT_LLM == 0)); then
  cp "$LLAMA_SERVER" "$BUNDLE_DIR/payload/runtime/llama/llama-server"
  chmod 0755 "$BUNDLE_DIR/payload/runtime/llama/llama-server"
  cp "$MODEL_FILE" "$BUNDLE_DIR/payload/models/$MODEL_BASENAME"
fi

if [[ -n "$OS_PACKAGES_DIR" ]]; then
  while IFS= read -r -d '' package_file; do
    cp "$package_file" "$BUNDLE_DIR/payload/os-packages/"
  done < <(
    find "$OS_PACKAGES_DIR" -maxdepth 1 -type f \
      \( -name '*.deb' -o -name 'manifest.sha256' -o -name 'packages.tsv' -o -name 'source-os.env' \) \
      -print0 | LC_ALL=C sort -z
  )
fi

info "Устанавливаем только рабочие зависимости npm в комплект"
(
  cd "$BUNDLE_DIR/payload/app"
  PATH="$BUNDLE_DIR/payload/runtime/node/bin:$PATH" \
    "$BUNDLE_DIR/payload/runtime/node/bin/npm" ci \
      --omit=dev --ignore-scripts --no-audit --no-fund
)

cp "$SCRIPT_DIR/lib.sh" \
  "$SCRIPT_DIR/verify-bundle.sh" \
  "$SCRIPT_DIR/install.sh" \
  "$SCRIPT_DIR/update.sh" \
  "$SCRIPT_DIR/backup.sh" \
  "$SCRIPT_DIR/restore.sh" \
  "$SCRIPT_DIR/first-run.sh" \
  "$SCRIPT_DIR/healthcheck.mjs" \
  "$SCRIPT_DIR/http-check.mjs" \
  "$SCRIPT_DIR/smoke-test.sh" \
  "$SCRIPT_DIR/target-release-gate.sh" \
  "$SCRIPT_DIR/ux-acceptance-gate.sh" \
  "$SCRIPT_DIR/ux-acceptance-gate.mjs" \
  "$SCRIPT_DIR/verify-release.mjs" \
  "$BUNDLE_DIR/"
cp "$ROOT_DIR/docs/RELEASE_NOTES.md" "$BUNDLE_DIR/RELEASE_NOTES.md"
cp "$ROOT_DIR/docs/SUPPORT_MATRIX.md" "$BUNDLE_DIR/SUPPORT_MATRIX.md"
chmod 0755 "$BUNDLE_DIR"/*.sh "$BUNDLE_DIR"/*.mjs

printf '%s\n' "$VERSION" > "$BUNDLE_DIR/VERSION"

if [[ "$UX_ACCEPTANCE_PROFILE" == "with" ]]; then
  [[ "$(git -C "$ROOT_DIR" rev-parse HEAD)" == "$UX_SOURCE_COMMIT" ]] || \
    die "HEAD изменился при копировании payload; UX acceptance-комплект не создан."
  [[ -z "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=normal)" ]] || \
    die "Git checkout изменился при копировании payload; UX acceptance-комплект не создан."
fi

MODEL_NAME=""
MODEL_SHA256=""
LLAMA_SHA256=""
if ((WITHOUT_LLM == 0)); then
  MODEL_NAME="$MODEL_BASENAME"
  MODEL_SHA256="$(sha256_of "$MODEL_FILE")"
  LLAMA_SHA256="$(sha256_of "$LLAMA_SERVER")"
fi

PREVIEW_ENABLED="$([[ "$PREVIEW_PROFILE" == "with" ]] && printf true || printf false)"
PREVIEW_CONVERTER_PATH="$(read_env_value "$BUNDLE_DIR/payload/config/docomator.env.example" DOCOMATOR_LIBREOFFICE_BIN)"
PREVIEW_TIMEOUT_MS="$(read_env_value "$BUNDLE_DIR/payload/config/docomator.env.example" DOCOMATOR_PREVIEW_TIMEOUT_MS)"
PREVIEW_MAX_BYTES="$(read_env_value "$BUNDLE_DIR/payload/config/docomator.env.example" DOCOMATOR_PREVIEW_MAX_BYTES)"
OS_PACKAGES_INCLUDED=false
OS_PACKAGES_MANIFEST_SHA256=""
OS_PACKAGES_INVENTORY_SHA256=""
OS_PACKAGE_SOURCE_JSON="null"
if [[ -n "$OS_PACKAGES_DIR" ]]; then
  OS_PACKAGES_INCLUDED=true
  OS_PACKAGES_MANIFEST_SHA256="$(sha256_of "$OS_PACKAGES_DIR/manifest.sha256")"
  OS_PACKAGES_INVENTORY_SHA256="$(sha256_of "$OS_PACKAGES_DIR/packages.tsv")"
  SOURCE_OS_ID="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" OS_ID)"
  SOURCE_OS_VERSION_ID="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" OS_VERSION_ID)"
  SOURCE_DEB_ARCHITECTURE="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" DEB_ARCHITECTURE)"
  OS_PACKAGE_SOURCE_JSON="{\"id\":\"$SOURCE_OS_ID\",\"versionId\":\"$SOURCE_OS_VERSION_ID\",\"architecture\":\"$SOURCE_DEB_ARCHITECTURE\"}"
fi

UX_ACCEPTANCE_INCLUDED=false
UX_CHROMIUM_PACKAGE_METADATA=""
UX_CHROMIUM_PACKAGE_VERSION_METADATA=""
UX_CHROMIUM_PATH_METADATA=""
UX_PLAYWRIGHT_VERSION=""
UX_AXE_PLAYWRIGHT_VERSION=""
if [[ "$UX_ACCEPTANCE_PROFILE" == "with" ]]; then
  UX_ACCEPTANCE_INCLUDED=true
  UX_CHROMIUM_PACKAGE_METADATA="$UX_CHROMIUM_PACKAGE"
  UX_CHROMIUM_PACKAGE_VERSION_METADATA="$UX_CHROMIUM_PACKAGE_VERSION"
  UX_CHROMIUM_PATH_METADATA="$UX_CHROMIUM_BIN"
  UX_PLAYWRIGHT_VERSION="$("$BUNDLED_NODE" -e \
    'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' \
    "$ROOT_DIR/node_modules/playwright/package.json")"
  UX_AXE_PLAYWRIGHT_VERSION="$("$BUNDLED_NODE" -e \
    'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).version)' \
    "$ROOT_DIR/node_modules/@axe-core/playwright/package.json")"
  [[ "$UX_PLAYWRIGHT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && \
     "$UX_AXE_PLAYWRIGHT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
    die "Не удалось определить закреплённые версии Playwright/axe."
fi

cat > "$BUNDLE_DIR/release.json" <<EOF_JSON
{
  "name": "docomator",
  "version": "$VERSION",
  "builtAt": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "gitCommit": "$GIT_COMMIT",
  "targetArchitecture": "$NODE_ARCH",
  "nodeVersion": "$ACTUAL_NODE_VERSION",
  "previewEnabled": $PREVIEW_ENABLED,
  "previewConverterPath": "$PREVIEW_CONVERTER_PATH",
  "previewTimeoutMs": $PREVIEW_TIMEOUT_MS,
  "previewMaxBytes": $PREVIEW_MAX_BYTES,
  "osPackagesIncluded": $OS_PACKAGES_INCLUDED,
  "osPackagesManifestSha256": "$OS_PACKAGES_MANIFEST_SHA256",
  "osPackagesInventorySha256": "$OS_PACKAGES_INVENTORY_SHA256",
  "osPackageSource": $OS_PACKAGE_SOURCE_JSON,
  "uxAcceptanceIncluded": $UX_ACCEPTANCE_INCLUDED,
  "uxChromiumPackage": "$UX_CHROMIUM_PACKAGE_METADATA",
  "uxChromiumPackageVersion": "$UX_CHROMIUM_PACKAGE_VERSION_METADATA",
  "uxChromiumPath": "$UX_CHROMIUM_PATH_METADATA",
  "uxPlaywrightVersion": "$UX_PLAYWRIGHT_VERSION",
  "uxAxePlaywrightVersion": "$UX_AXE_PLAYWRIGHT_VERSION",
  "llmIncluded": $([[ $WITHOUT_LLM -eq 0 ]] && printf true || printf false),
  "llamaServerSha256": "$LLAMA_SHA256",
  "modelFile": "$MODEL_NAME",
  "modelSha256": "$MODEL_SHA256"
}
EOF_JSON

write_symlink_manifest "$BUNDLE_DIR" "$BUNDLE_DIR/manifest.symlinks"

(
  cd "$BUNDLE_DIR"
  find . -type f ! -path './manifest.sha256' -print0 \
    | sort -z \
    | xargs -0 sha256sum > manifest.sha256
)

"$BUNDLE_DIR/verify-bundle.sh" "$BUNDLE_DIR"

tar -czf "$ARCHIVE_PATH" -C "$OUTPUT_DIR" "$BUNDLE_NAME"
(
  cd "$OUTPUT_DIR"
  sha256sum "$(basename "$ARCHIVE_PATH")" > "$(basename "$ARCHIVE_CHECKSUM_PATH")"
)
info "Автономный комплект создан: $ARCHIVE_PATH"
info "Контрольная сумма архива создана: $ARCHIVE_CHECKSUM_PATH"
