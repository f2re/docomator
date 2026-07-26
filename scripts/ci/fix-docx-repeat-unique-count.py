from pathlib import Path

path = Path(__file__).resolve().parents[2] / "packages/template-compiler/src/multi-field.test.ts"
value = path.read_text(encoding="utf-8")
old = "  assert.equal(new Set(wordIds).size, 7);"
new = "  assert.equal(new Set(wordIds).size, 6);"
if value.count(old) != 1:
    raise RuntimeError(f"Ожидалось одно вхождение, найдено {value.count(old)}")
path.write_text(value.replace(old, new, 1), encoding="utf-8")
print("updated DOCX repeat unique ID expectation")
