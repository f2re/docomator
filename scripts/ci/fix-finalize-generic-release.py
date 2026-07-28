from pathlib import Path

path = Path(__file__).resolve().with_name("finalize-generic-release.py")
value = path.read_text(encoding="utf-8")
old = '''# Exact example inventories inside the release builder and verifier.
for relative in [
    "scripts/offline/prepare-bundle.sh",
    "scripts/offline/verify-bundle.sh",
    "scripts/offline/verify-bundle.test.mjs",
]:
    value = read(relative)
    value = replace_in(
        value,
        '  "data/employees.csv"\\n',
        '  "data/auditoriums.csv"\\n  "data/employees.csv"\\n  "data/scientific-articles.csv"\\n',
        f"{relative} example list"
    )
    write(relative, value)
'''
new = '''# Exact example inventories inside the release builder and verifier.
example_inventory_patches = [
    (
        "scripts/offline/prepare-bundle.sh",
        '  "data/employees.csv"\\n',
        '  "data/auditoriums.csv"\\n  "data/employees.csv"\\n  "data/scientific-articles.csv"\\n',
        1,
    ),
    (
        "scripts/offline/verify-bundle.sh",
        '  "data/employees.csv"\\n',
        '  "data/auditoriums.csv"\\n  "data/employees.csv"\\n  "data/scientific-articles.csv"\\n',
        2,
    ),
    (
        "scripts/offline/verify-bundle.test.mjs",
        '  "data/employees.csv",\\n',
        '  "data/auditoriums.csv",\\n  "data/employees.csv",\\n  "data/scientific-articles.csv",\\n',
        2,
    ),
]
for relative, old_item, new_items, expected_count in example_inventory_patches:
    value = read(relative)
    actual_count = value.count(old_item)
    if actual_count != expected_count:
        raise RuntimeError(
            f"{relative}: expected {expected_count} example list occurrence(s), found {actual_count}"
        )
    write(relative, value.replace(old_item, new_items, expected_count))
'''
if value.count(old) != 1:
    raise RuntimeError("example inventory patch block not found")
path.write_text(value.replace(old, new, 1), encoding="utf-8")
print("final generic release script fixed")
