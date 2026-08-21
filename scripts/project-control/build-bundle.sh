#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
PYTHON="${PROJECT_CONTROL_PYTHON_BIN:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || { echo "Для Project Control ZIP на build-машине нужен python3 (PROJECT_CONTROL_PYTHON_BIN)." >&2; exit 2; }
OUTPUT_DIR="$ROOT/offline-bundles"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
ARGS=("$@")
for ((i=0; i<${#ARGS[@]}; i++)); do
  case "${ARGS[$i]}" in
    --output)
      ((i + 1 < ${#ARGS[@]})) || { echo "--output требует значение" >&2; exit 2; }
      OUTPUT_DIR="${ARGS[$((i + 1))]}" ;;
    --version)
      ((i + 1 < ${#ARGS[@]})) || { echo "--version требует значение" >&2; exit 2; }
      VERSION="${ARGS[$((i + 1))]}" ;;
  esac
done
OUTPUT_DIR="$($PYTHON -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$OUTPUT_DIR")"
"$ROOT/scripts/offline/prepare-bundle.sh" "$@"
ARCHIVE="$(find "$OUTPUT_DIR" -maxdepth 1 -type f -name "docomator-${VERSION}-linux-*.tar.gz" -printf '%T@\t%p\n' | LC_ALL=C sort -nr | head -n 1 | cut -f2-)"
[[ -n "$ARCHIVE" && -f "$ARCHIVE" && -f "$ARCHIVE.sha256" ]] || { echo "Штатный builder завершился, но native archive для версии $VERSION не найден в $OUTPUT_DIR" >&2; exit 3; }
GIT_COMMIT="unknown"
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
fi
PACKAGE_ARGS=(
  --archive "$ARCHIVE"
  --output "$OUTPUT_DIR"
  --project-id docomator
  --display-name "Оформлятор"
  --adapter docomator-v1
  --version "$VERSION"
  --source-commit "$GIT_COMMIT"
  --native-format docomator-offline-v2
)
[[ -z "${F2RE_RELEASE_SIGNING_KEY:-}" ]] || PACKAGE_ARGS+=(--signing-key "$F2RE_RELEASE_SIGNING_KEY")
"$PYTHON" "$ROOT/scripts/project-control/package-release.py" "${PACKAGE_ARGS[@]}"
