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
for relative, expected_count in [
    ("scripts/offline/prepare-bundle.sh", 1),
    ("scripts/offline/verify-bundle.sh", 2),
    ("scripts/offline/verify-bundle.test.mjs", 1),
]:
    value = read(relative)
    old_item = '  "data/employees.csv"\\n'
    new_items = (
        '  "data/auditoriums.csv"\\n'
        '  "data/employees.csv"\\n'
        '  "data/scientific-articles.csv"\\n'
    )
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
