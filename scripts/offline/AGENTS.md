# Offline release script rules

- Target-side scripts are network-free. Do not add `curl`, `wget`, npm registry or apt repository access to install/update.
- Connected-host downloads belong only in preparation/collection scripts and require checksum verification.
- Preserve existing configuration and secrets during updates.
- Never delete outside explicitly resolved install/data/config roots.
- `VERSION` is the only manually edited product-version source; concrete build identity comes from SHA-256 of `release.json`.
- Use an immutable build-identity release directory (`<version>-<release metadata hash prefix>`) plus atomic `current` symlink. A different verified build with the same product version must be installable.
- Verify bundle inventory/object types/SHA-256 before system changes. Do not require an extracted bundle or its parent directories to be `root:root` merely to start install/update.
- Root is required only for real protected-system mutations: install/config/data roots, service account, systemd and local `.deb` installation.
- Stop services before database copy; restore database, configuration and symlink on failed migration/readiness.
- All paths and arguments must be quoted. Use `set -Eeuo pipefail`.
- Keep scripts compatible with Bash available on Debian/Astra reference images.
- Run `bash scripts/ci/validate-shell.sh` and the offline contract/smoke tests after every change.
