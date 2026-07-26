from pathlib import Path

path = Path(__file__).resolve().parents[2] / "apps/api/ui/interface-hierarchy.css"
value = path.read_text(encoding="utf-8")
old = "  --hint: #747b86;"
new = "  --hint: #6d7480;"
if value.count(old) != 1:
    raise RuntimeError("Не найдено единственное значение светлого вторичного текста.")
path.write_text(value.replace(old, new, 1), encoding="utf-8")
print("updated interface hint contrast")
