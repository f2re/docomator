from pathlib import Path

path = Path(__file__).resolve().parents[2] / "packages/storage/src/data-import.ts"
value = path.read_text(encoding="utf-8")
replacements = {
    'generateOpaqueStableKey("entity_field")': 'generateOpaqueStableKey(entityTypeKey === "person" ? "employee_field" : "entity_field")',
    'generateOpaqueStableKey("entity_group")': 'generateOpaqueStableKey(entityTypeKey === "person" ? "employee_group" : "entity_group")',
}
for old, new in replacements.items():
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"expected one occurrence, found {count}: {old}")
    value = value.replace(old, new, 1)
path.write_text(value, encoding="utf-8")
print("generic import keys keep person compatibility")
