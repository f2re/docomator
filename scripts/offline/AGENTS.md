# Offline release script rules

- Target-side scripts are network-free. Do not add `curl`, `wget`, npm registry or apt repository access to install/update.
- Connected-host downloads belong only in preparation/collection scripts and require checksum verification.
- Preserve existing configuration and secrets during updates.
- Never delete outside explicitly resolved install/data/config roots.
- Use a versioned release directory plus atomic `current` symlink.
- Stop services before database copy; restore database and symlink on failed health-check.
- All paths and arguments must be quoted. Use `set -Eeuo pipefail`.
- Keep scripts compatible with Bash available on Debian/Astra reference images.
- Run `bash scripts/ci/validate-shell.sh` after every change.
