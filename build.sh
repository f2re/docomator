#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bash "$ROOT_DIR/scripts/offline/prepare-bundle.sh" \
  --without-llm \
  --without-preview \
  --without-ux-acceptance \
  --skip-tests \
  "$@"
