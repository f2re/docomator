from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch_all(relative: str, old: str, new: str, minimum: int = 1) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count < minimum:
        raise RuntimeError(f"{relative}: expected at least {minimum}, found {count}: {old!r}")
    path.write_text(value.replace(old, new), encoding="utf-8")
    print(f"updated {relative}: {count}")


# Include the browser regression in the exact acceptance inventories.
for relative, old, new in [
    (
        "scripts/offline/prepare-bundle.sh",
        '    "generic-entities.spec.mjs"\n',
        '    "generic-entities.spec.mjs"\n    "import-normalization.spec.mjs"\n',
    ),
    (
        "scripts/offline/verify-release.mjs",
        '    "generic-entities.spec.mjs",\n',
        '    "generic-entities.spec.mjs",\n    "import-normalization.spec.mjs",\n',
    ),
    (
        "scripts/offline/verify-bundle.test.mjs",
        '  "generic-entities.spec.mjs",\n',
        '  "generic-entities.spec.mjs",\n  "import-normalization.spec.mjs",\n',
    ),
]:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    if "import-normalization.spec.mjs" not in value:
        if old not in value:
            raise RuntimeError(f"{relative}: E2E inventory marker not found")
        path.write_text(value.replace(old, new, 1), encoding="utf-8")
        print(f"updated {relative}")

# Bundle test fixtures create placeholder files for every mandatory runtime asset.
fixture_path = ROOT / "scripts/offline/verify-bundle.test.mjs"
fixture = fixture_path.read_text(encoding="utf-8")
for old, new in [
    (
        '"apps/api/ui/entity-workspace.js",\n',
        '"apps/api/ui/entity-workspace.js",\n    "apps/api/ui/import-normalization.js",\n',
    ),
    (
        '"scripts/runtime/automatic-backup.mjs",\n',
        '"scripts/runtime/automatic-backup.mjs",\n    "scripts/runtime/db-admin.mjs",\n',
    ),
]:
    if new.strip() not in fixture:
        if old not in fixture:
            raise RuntimeError(f"verify-bundle fixture marker not found: {old!r}")
        fixture = fixture.replace(old, new, 1)
fixture_path.write_text(fixture, encoding="utf-8")
print("updated scripts/offline/verify-bundle.test.mjs fixtures")

print("offline import-normalization inventory applied")
