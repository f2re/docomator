from pathlib import Path

path = Path(__file__).resolve().parents[2] / "apps/api/ui/bulk-data-import-v3.js"
value = path.read_text(encoding="utf-8")
old = "Например, `EMP-001` и `emp-001` не создадут два объекта."
new = "Например, <code>EMP-001</code> и <code>emp-001</code> не создадут два объекта."
if value.count(old) != 1:
    raise RuntimeError(f"Ожидалось одно вхождение, найдено {value.count(old)}")
path.write_text(value.replace(old, new, 1), encoding="utf-8")
print("bulk import normalization template fixed")
