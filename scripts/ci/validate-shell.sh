#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mapfile -d '' files < <(find "$ROOT_DIR/scripts" -type f -name '*.sh' -print0 | sort -z)

if ((${#files[@]} == 0)); then
  echo "No shell scripts found."
  exit 0
fi

for file in "${files[@]}"; do
  bash -n "$file"
done

echo "Validated ${#files[@]} shell scripts."
