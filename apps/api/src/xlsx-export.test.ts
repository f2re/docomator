import assert from "node:assert/strict";
import test from "node:test";

import { buildDataExportXlsx, XlsxExportLimitError } from "./xlsx-export.js";

function storedEntries(archive: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    assert.equal(method, 0);
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const bodyStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    result.set(name, archive.subarray(bodyStart, bodyStart + size));
    offset = bodyStart + size;
  }
  return result;
}

test("XLSX-экспорт создаёт минимальный Office Open XML пакет с текстовыми значениями", () => {
  const archive = buildDataExportXlsx(
    ["Название", "Вместимость, мест"],
    [["'=2+2", "12"], ["Аудитория 205", "18"]]
  );
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  const entries = storedEntries(archive);
  assert.deepEqual([...entries.keys()], [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml"
  ]);
  const sheet = entries.get("xl/worksheets/sheet1.xml")?.toString("utf8") ?? "";
  assert.match(sheet, /<dimension ref="A1:B3"\/>/u);
  assert.match(sheet, /<pane ySplit="1"/u);
  assert.match(sheet, /Название/u);
  assert.match(sheet, /Вместимость, мест/u);
  assert.match(sheet, /'=2\+2/u);
  assert.doesNotMatch(sheet, /<f>/u);
});

test("XLSX-экспорт не обрезает слишком длинное значение молча", () => {
  assert.throws(
    () => buildDataExportXlsx(["Название"], [["x".repeat(32_768)]]),
    (error: unknown) =>
      error instanceof XlsxExportLimitError && /32767/u.test(error.message)
  );
});
