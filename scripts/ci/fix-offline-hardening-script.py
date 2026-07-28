from pathlib import Path

path = Path(__file__).resolve().with_name("apply-offline-hardening.py")
value = path.read_text(encoding="utf-8")
replacements = {
    "    new_verify_package_set,\n    lib,": "    lambda _match: new_verify_package_set,\n    lib,",
    "    new_verify_target,\n    lib,": "    lambda _match: new_verify_target,\n    lib,",
}
for old, new in replacements.items():
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"expected one occurrence, found {count}: {old!r}")
    value = value.replace(old, new, 1)
path.write_text(value, encoding="utf-8")
print("offline hardening script fixed")
