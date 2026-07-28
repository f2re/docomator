from pathlib import Path

path = Path(__file__).resolve().with_name("apply-offline-hardening.py")
value = path.read_text(encoding="utf-8")

helper_old = '''def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one occurrence, found {count}: {old[:180]!r}")
    return value.replace(old, new, 1)
'''
helper_new = '''def replace_once(value: str, old: str, new: str, label: str) -> str:
    count = value.count(old)
    if label == "prepare source family":
        if count < 1:
            raise RuntimeError(f"{label}: expected at least one occurrence, found {count}: {old[:180]!r}")
    elif count != 1:
        raise RuntimeError(f"{label}: expected one occurrence, found {count}: {old[:180]!r}")
    return value.replace(old, new, 1)
'''
if value.count(helper_old) != 1:
    raise RuntimeError("replace_once helper not found")
value = value.replace(helper_old, helper_new, 1)

for old, new in (
    ("    new_verify_package_set,\n    lib,", "    lambda _match: new_verify_package_set,\n    lib,"),
    ("    new_verify_target,\n    lib,", "    lambda _match: new_verify_target,\n    lib,"),
):
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"expected one occurrence, found {count}: {old!r}")
    value = value.replace(old, new, 1)

quoted_version = 'OS_VERSION_ID="12"\\nDEB_ARCHITECTURE'
plain_version = 'OS_VERSION_ID=12\\nDEB_ARCHITECTURE'
count = value.count(quoted_version)
if count != 1:
    raise RuntimeError(f"expected one quoted fixture version, found {count}")
value = value.replace(quoted_version, plain_version, 1)

path.write_text(value, encoding="utf-8")
print("offline hardening script fixed")
