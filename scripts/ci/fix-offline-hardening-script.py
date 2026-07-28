from pathlib import Path

path = Path(__file__).resolve().with_name("apply-offline-hardening.py")
value = path.read_text(encoding="utf-8")
replacements = {
    "    new_verify_package_set,\n    lib,": "    lambda _match: new_verify_package_set,\n    lib,",
    "    new_verify_target,\n    lib,": "    lambda _match: new_verify_target,\n    lib,",
    'OS_VERSION_ID="12"\\nDEB_ARCHITECTURE': 'OS_VERSION_ID=12\\nDEB_ARCHITECTURE',
}
for old, new in replacements.items():
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"expected one occurrence, found {count}: {old!r}")
    value = value.replace(old, new, 1)

old_block = '''prepare = replace_once(
    prepare,
    '  SOURCE_DEB_ARCHITECTURE="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" DEB_ARCHITECTURE)"\\n',
    '  SOURCE_OS_FAMILY="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" OS_FAMILY)"\\n  SOURCE_DEB_ARCHITECTURE="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" DEB_ARCHITECTURE)"\\n  [[ "$TARGET_PROFILE" != "generic" && "$SOURCE_OS_FAMILY" == "$TARGET_PROFILE" ]] || \\\\\\n    die "--target-profile не совпадает с OS_FAMILY набора .deb"\\n',
    "prepare source family",
)
'''
new_block = '''prepare = prepare.replace(
    '  SOURCE_DEB_ARCHITECTURE="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" DEB_ARCHITECTURE)"\\n',
    '  SOURCE_OS_FAMILY="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" OS_FAMILY)"\\n  SOURCE_DEB_ARCHITECTURE="$(read_env_value "$OS_PACKAGES_DIR/source-os.env" DEB_ARCHITECTURE)"\\n  [[ "$TARGET_PROFILE" != "generic" && "$SOURCE_OS_FAMILY" == "$TARGET_PROFILE" ]] || \\\\\\n    die "--target-profile не совпадает с OS_FAMILY набора .deb"\\n',
    1,
)
'''
if value.count(old_block) != 1:
    raise RuntimeError("prepare source family patch block not found")
value = value.replace(old_block, new_block, 1)

path.write_text(value, encoding="utf-8")
print("offline hardening script fixed")
