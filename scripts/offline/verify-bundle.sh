#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

BUNDLE_ROOT="${1:-$SCRIPT_DIR}"
BUNDLE_ROOT="$(absolute_path "$BUNDLE_ROOT")"

[[ -f "$BUNDLE_ROOT/VERSION" ]] || die "VERSION is missing in $BUNDLE_ROOT"
[[ -f "$BUNDLE_ROOT/manifest.sha256" ]] || die "manifest.sha256 is missing in $BUNDLE_ROOT"
[[ -d "$BUNDLE_ROOT/payload/app" ]] || die "payload/app is missing"
[[ -x "$BUNDLE_ROOT/payload/runtime/node/bin/node" ]] || die "bundled Node.js runtime is missing"

info "Verifying offline bundle checksums"
(
  cd "$BUNDLE_ROOT"
  sha256sum --check --strict --quiet manifest.sha256
)
info "Offline bundle is valid: version $(<"$BUNDLE_ROOT/VERSION")"
