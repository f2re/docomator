from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / "packages/template-compiler/src/scalar-render.ts"
value = path.read_text(encoding="utf-8")
backslash = chr(92)
replacements = {
    chr(2): backslash + "2",
    chr(3): backslash + "3",
    chr(8): backslash + "b",
    '"' + chr(0) + '"': '"' + backslash + "u0000" + '"',
}
for old, new in replacements.items():
    value = value.replace(old, new)
if any(character in value for character in (chr(0), chr(2), chr(3), chr(8))):
    raise RuntimeError("В scalar-render.ts остались управляющие знаки.")
path.write_text(value, encoding="utf-8")
print("repaired TypeScript escape sequences")
