from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / "packages/template-compiler/src/multi-field.test.ts"
value = path.read_text(encoding="utf-8")

replacements = [
    (
        '  assert.match(xml, /<w:sdtContent><w:tr><w:trPr><w:cantSplit\\/><\\/w:trPr>/u);',
        '''  assert.match(
    xml,
    /<w:tr><w:trPr><w:cantSplit\\/><\\/w:trPr>[\\s\\S]*?airepeat:[a-f0-9]{24}[\\s\\S]*?<\\/w:tr>/u
  );
  assert.doesNotMatch(
    xml,
    /<w:tbl\\b[^>]*>[\\s\\S]*?<w:sdt\\b[^>]*>[\\s\\S]*?<w:sdtContent>[\\s\\S]*?<w:tr\\b/u
  );'''
    ),
    ('  assert.equal(wordIds.length, 7);', '  assert.equal(wordIds.length, 6);'),
    (
        '  assert.equal(wordIds.length, 1 + 1_000 * 2);',
        '  assert.equal(wordIds.length, 1_000 * 2);'
    )
]

for old, new in replacements:
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"Ожидалось одно вхождение, найдено {count}: {old}")
    value = value.replace(old, new, 1)

path.write_text(value, encoding="utf-8")
print("updated DOCX repeat test expectations")
