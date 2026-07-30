from pathlib import Path

path = Path(__file__).resolve().parents[2] / "packages/storage/src/database-admin.test.ts"
value = path.read_text(encoding="utf-8")
old = r"/'\=ОПАСНАЯ ФОРМУЛА/u"
new = r"/'=ОПАСНАЯ ФОРМУЛА/u"
if value.count(old) != 1:
    raise RuntimeError(f"Ожидалось одно вхождение, найдено {value.count(old)}")
path.write_text(value.replace(old, new, 1), encoding="utf-8")
print("database admin CSV formula assertion fixed")
