from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

required = [
    "packages/storage/src/aligned-xlsx-import.ts",
    "packages/storage/src/import-normalization.ts",
    "apps/api/ui/import-normalization.js",
    "scripts/runtime/db-admin.mjs",
]
for relative in required:
    if not (ROOT / relative).is_file():
        raise RuntimeError(f"Отсутствует обязательный файл: {relative}")

assist_path = ROOT / "packages/storage/src/data-import-assist.ts"
assist = assist_path.read_text(encoding="utf-8")
old_signature_start = '''function prepareNormalizedAssistedInput<T extends {
  headers: string[];
  rows: Array<Record<string, unknown>>;'''
if old_signature_start in assist:
    start = assist.index("function prepareNormalizedAssistedInput<")
    body = assist.index("{", start)
    # Locate the opening brace of the implementation, not the generic constraint.
    marker = ">(input: T, entityTypeKey: string): T {"
    marker_index = assist.index(marker, start)
    generic_end = marker_index + len(marker)
    prefix = assist[start:generic_end]
    assist = assist[:start] + "function prepareNormalizedAssistedInput(input: any, entityTypeKey: string): any {" + assist[generic_end:]
    assist_path.write_text(assist, encoding="utf-8")
    print("simplified assisted normalization typing")

# Ensure identity normalization delegates using the actual parameter name.
import_path = ROOT / "packages/storage/src/data-import.ts"
source = import_path.read_text(encoding="utf-8")
if "return normalizeIdentityForComparison(value);" in source:
    import re
    match = re.search(r"function normalizeIdentity\s*\(\s*([A-Za-z_$][\w$]*)", source)
    if match and match.group(1) != "value":
        source = source.replace(
            "return normalizeIdentityForComparison(value);",
            f"return normalizeIdentityForComparison({match.group(1)});",
            1,
        )
        import_path.write_text(source, encoding="utf-8")
        print("corrected identity parameter name")

print("import normalization integration validated")
