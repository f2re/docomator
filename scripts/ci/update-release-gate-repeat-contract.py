from pathlib import Path

path = Path(__file__).resolve().parents[2] / "scripts/ci/release-gate.mjs"
value = path.read_text(encoding="utf-8")
old = '''  assert.equal((repeatXml.match(/<w:tr>/gu) ?? []).length, 11);
  assert.equal((repeatXml.match(/<w:cantSplit\/>/gu) ?? []).length, 10);
  assert.equal((repeatXml.match(/aifield:/gu) ?? []).length, 10);
  assert.equal((repeatXml.match(/airepeat:/gu) ?? []).length, 1);
  const repeatWordIds = [...repeatXml.matchAll(/<w:id\s+w:val="(\d+)"\/>/gu)].map(
    (match) => match[1]
  );
  assert.equal(repeatWordIds.length, 11);'''
new = '''  assert.equal((repeatXml.match(/<w:tbl\\b/gu) ?? []).length, 1);
  assert.equal((repeatXml.match(/<w:tr>/gu) ?? []).length, 11);
  assert.equal((repeatXml.match(/<w:cantSplit\/>/gu) ?? []).length, 10);
  assert.equal((repeatXml.match(/aifield:/gu) ?? []).length, 10);
  assert.equal((repeatXml.match(/airepeat:/gu) ?? []).length, 0);
  assert.match(
    repeatXml,
    /<w:tbl\\b[^>]*>[\\s\\S]*?<w:tr>[\\s\\S]*?<w:t>ФИО<\\/w:t>[\\s\\S]*?<\\/w:tr><w:tr>[\\s\\S]*?Сотрудник 01[\\s\\S]*?<\\/w:tr>/u
  );
  const repeatWordIds = [...repeatXml.matchAll(/<w:id\s+w:val="(\d+)"\/>/gu)].map(
    (match) => match[1]
  );
  assert.equal(repeatWordIds.length, 10);'''
if value.count(old) != 1:
    raise RuntimeError(f"Ожидалось одно вхождение, найдено {value.count(old)}")
path.write_text(value.replace(old, new, 1), encoding="utf-8")
print("updated release gate for direct DOCX table rows")
