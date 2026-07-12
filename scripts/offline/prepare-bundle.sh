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
SKIP_TESTS=0
INCLUDE_SOURCES=0
WITHOUT_LLM=0
FORCE=0

usage() {
  cat <<'USAGE'
Usage: scripts/offline/prepare-bundle.sh [options]

Builds a self-contained offline release bundle on a connected reference host.
The build host should use the same CPU architecture and a compatible glibc as
the target Debian/Astra Linux server.

Options:
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
  --os-packages-dir DIR        Directory containing offline .deb packages
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
    --os-packages-dir) OS_PACKAGES_DIR="$2"; shift 2 ;;
    --include-sources) INCLUDE_SOURCES=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

require_command tar
require_command sha256sum
require_command find
require_command sort
require_command xargs

case "$TARGET_ARCH" in
  x86_64|amd64) NODE_ARCH="x64" ;;
  aarch64|arm64) NODE_ARCH="arm64" ;;
  *) die "Unsupported target architecture: $TARGET_ARCH" ;;
esac

if ((WITHOUT_LLM == 0)); then
  [[ -n "$LLAMA_SERVER" && -n "$MODEL_FILE" ]] || die \
    "Provide both --llama-server and --model, or explicitly pass --without-llm."
  [[ -x "$LLAMA_SERVER" || -f "$LLAMA_SERVER" ]] || die "llama-server not found: $LLAMA_SERVER"
  [[ -f "$MODEL_FILE" ]] || die "GGUF model not found: $MODEL_FILE"
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

BUNDLE_NAME="docomator-${VERSION}-linux-${NODE_ARCH}"
BUNDLE_DIR="$OUTPUT_DIR/$BUNDLE_NAME"
ARCHIVE_PATH="$OUTPUT_DIR/${BUNDLE_NAME}.tar.gz"

if [[ -e "$BUNDLE_DIR" || -e "$ARCHIVE_PATH" ]]; then
  ((FORCE == 1)) || die "Bundle already exists; pass --force to replace it"
  rm -rf "$BUNDLE_DIR" "$ARCHIVE_PATH"
fi

mkdir -p \
  "$BUNDLE_DIR/payload/app/apps/api" \
  "$BUNDLE_DIR/payload/app/apps/worker" \
  "$BUNDLE_DIR/payload/app/packages/config" \
  "$BUNDLE_DIR/payload/app/packages/contracts" \
  "$BUNDLE_DIR/payload/app/packages/storage" \
  "$BUNDLE_DIR/payload/app/scripts/runtime" \
  "$BUNDLE_DIR/payload/runtime/node" \
  "$BUNDLE_DIR/payload/runtime/llama" \
  "$BUNDLE_DIR/payload/models" \
  "$BUNDLE_DIR/payload/deploy/systemd" \
  "$BUNDLE_DIR/payload/config" \
  "$BUNDLE_DIR/payload/os-packages"

cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$ROOT_DIR/VERSION" \
  "$BUNDLE_DIR/payload/app/"
cp -a "$ROOT_DIR/migrations" "$BUNDLE_DIR/payload/app/"
cp -a "$ROOT_DIR/scripts/runtime/." "$BUNDLE_DIR/payload/app/scripts/runtime/"

for workspace in apps/api apps/worker packages/config packages/contracts packages/storage; do
  destination="$BUNDLE_DIR/payload/app/$workspace"
  cp "$ROOT_DIR/$workspace/package.json" "$destination/"
  cp -a "$ROOT_DIR/$workspace/dist" "$destination/"
  if ((INCLUDE_SOURCES == 1)); then
    cp -a "$ROOT_DIR/$workspace/src" "$destination/"
    cp "$ROOT_DIR/$workspace/tsconfig.json" "$destination/"
  fi
done

cp -a "$ROOT_DIR/apps/api/ui" "$BUNDLE_DIR/payload/app/apps/api/"

cp -a "$NODE_STAGE/." "$BUNDLE_DIR/payload/runtime/node/"
cp -a "$ROOT_DIR/deploy/systemd/." "$BUNDLE_DIR/payload/deploy/systemd/"
cp "$ROOT_DIR/config/docomator.env.example" "$BUNDLE_DIR/payload/config/"

if ((WITHOUT_LLM == 0)); then
  cp "$LLAMA_SERVER" "$BUNDLE_DIR/payload/runtime/llama/llama-server"
  chmod 0755 "$BUNDLE_DIR/payload/runtime/llama/llama-server"
  cp "$MODEL_FILE" "$BUNDLE_DIR/payload/models/$(basename "$MODEL_FILE")"
fi

if [[ -n "$OS_PACKAGES_DIR" ]]; then
  [[ -d "$OS_PACKAGES_DIR" ]] || die "OS packages directory not found: $OS_PACKAGES_DIR"
  cp -a "$OS_PACKAGES_DIR/." "$BUNDLE_DIR/payload/os-packages/"
fi

info "Installing production-only npm dependencies into the payload"
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
  "$SCRIPT_DIR/healthcheck.mjs" \
  "$BUNDLE_DIR/"
chmod 0755 "$BUNDLE_DIR"/*.sh "$BUNDLE_DIR/healthcheck.mjs"

printf '%s\n' "$VERSION" > "$BUNDLE_DIR/VERSION"

GIT_COMMIT="unknown"
if git -C "$ROOT_DIR" rev-parse --verify HEAD >/dev/null 2>&1; then
  GIT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
fi

MODEL_NAME=""
MODEL_SHA256=""
LLAMA_SHA256=""
if ((WITHOUT_LLM == 0)); then
  MODEL_NAME="$(basename "$MODEL_FILE")"
  MODEL_SHA256="$(sha256_of "$MODEL_FILE")"
  LLAMA_SHA256="$(sha256_of "$LLAMA_SERVER")"
fi

cat > "$BUNDLE_DIR/release.json" <<EOF_JSON
{
  "name": "docomator",
  "version": "$VERSION",
  "builtAt": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "gitCommit": "$GIT_COMMIT",
  "targetArchitecture": "$NODE_ARCH",
  "nodeVersion": "$ACTUAL_NODE_VERSION",
  "llmIncluded": $([[ $WITHOUT_LLM -eq 0 ]] && printf true || printf false),
  "llamaServerSha256": "$LLAMA_SHA256",
  "modelFile": "$MODEL_NAME",
  "modelSha256": "$MODEL_SHA256"
}
EOF_JSON

(
  cd "$BUNDLE_DIR"
  find . -type f ! -name manifest.sha256 -print0 \
    | sort -z \
    | xargs -0 sha256sum > manifest.sha256
)

"$BUNDLE_DIR/verify-bundle.sh" "$BUNDLE_DIR"

tar -czf "$ARCHIVE_PATH" -C "$OUTPUT_DIR" "$BUNDLE_NAME"
info "Offline bundle created: $ARCHIVE_PATH"
