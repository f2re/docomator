#!/usr/bin/env bash
set -Eeuo pipefail

OLD_TARGET="${1:-}"
NEW_RELEASE="${2:-}"
RELEASES_DIR="${3:-}"

[[ -n "$OLD_TARGET" && -n "$NEW_RELEASE" && -n "$RELEASES_DIR" ]] || exit 0
[[ "$OLD_TARGET" == "$RELEASES_DIR/"* ]] || exit 0
[[ -x "$OLD_TARGET/runtime/llama/llama-server" ]] || exit 0
[[ ! -x "$NEW_RELEASE/runtime/llama/llama-server" ]] || exit 0
[[ -d "$NEW_RELEASE/runtime" ]] || exit 0

rm -rf -- "$NEW_RELEASE/runtime/llama"
cp -a -- "$OLD_TARGET/runtime/llama" "$NEW_RELEASE/runtime/llama"
printf 'preserved\n'
