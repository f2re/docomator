from pathlib import Path

path = Path(__file__).resolve().parents[2] / "packages/storage/src/database-admin.ts"
value = path.read_text(encoding="utf-8")
old = "as SqliteCountRow"
count = value.count(old)
if count != 3:
    raise RuntimeError(f"Ожидалось три приведения счётчика, найдено {count}")
path.write_text(value.replace(old, "as unknown as SqliteCountRow"), encoding="utf-8")
print("database count result types fixed")
