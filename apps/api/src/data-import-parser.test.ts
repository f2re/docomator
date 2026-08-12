import assert from "node:assert/strict";
import test from "node:test";

import { buildZipFixture } from "@docomator/document-intake/testing";

import { DataImportParseError, parseDataImportBuffer } from "./data-import-parser.js";

function xlsxFixture(sheetXml: string): Buffer {
  return buildZipFixture([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Сотрудники" sheetId="1" r:id="rId1"/></sheets></workbook>'
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: sheetXml
    }
  ]);
}

function inlineCell(reference: string | null, value: string): string {
  const coordinate = reference === null ? "" : ` r="${reference}"`;
  const escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<c${coordinate} t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`;
}

test("XLSX keeps explicit coordinates when a middle cell is omitted", async () => {
  const source = xlsxFixture(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${inlineCell("A1", "ФИО")}${inlineCell("B1", "Подразделение")}${inlineCell("C1", "Почта")}</row><row r="2">${inlineCell("A2", "Иванов Иван Иванович")}${inlineCell("C2", "ivanov@example.test")}</row></sheetData></worksheet>`
  );
  const parsed = await parseDataImportBuffer({
    buffer: source,
    fileName: "employees.xlsx"
  });

  assert.deepEqual(parsed.headers, ["ФИО", "Подразделение", "Почта"]);
  assert.deepEqual(parsed.rows, [
    {
      "ФИО": "Иванов Иван Иванович",
      "Подразделение": "",
      "Почта": "ivanov@example.test"
    }
  ]);
  assert.deepEqual(parsed.sourceRowNumbers, [2]);
});

test("XLSX counts self-closing and implicit blank cells without shifting columns", async () => {
  const source = xlsxFixture(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${inlineCell(null, "ФИО")}${inlineCell(null, "Телефон")}${inlineCell(null, "Должность")}</row><row r="3">${inlineCell(null, "Петров Пётр Петрович")}<c/>${inlineCell(null, "Инженер")}</row></sheetData></worksheet>`
  );
  const parsed = await parseDataImportBuffer({
    buffer: source,
    fileName: "implicit.xlsx"
  });

  assert.deepEqual(parsed.rows[0], {
    "ФИО": "Петров Пётр Петрович",
    "Телефон": "",
    "Должность": "Инженер"
  });
  assert.deepEqual(parsed.sourceRowNumbers, [3]);
});

test("XLSX preserves embedded newlines and physical source row numbers", async () => {
  const source = xlsxFixture(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2">${inlineCell("A2", "Код")}${inlineCell("B2", "Примечание")}</row><row r="5">${inlineCell("A5", "A-1")}${inlineCell("B5", "Первая строка\nВторая строка")}</row><row r="8"><c r="A8"/>${inlineCell("B8", "полностью неполная строка")}</row></sheetData></worksheet>`
  );
  const parsed = await parseDataImportBuffer({
    buffer: source,
    fileName: "lines.xlsx"
  });

  assert.equal(parsed.rows[0]?.["Примечание"], "Первая строка\nВторая строка");
  assert.deepEqual(parsed.sourceRowNumbers, [5, 8]);
  assert.match(parsed.warnings.join(" "), /строке 2/u);
});

test("XLSX assigns stable names to blank and duplicate headers", async () => {
  const source = xlsxFixture(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${inlineCell("A1", "Код")}${inlineCell("C1", "Код")}</row><row r="2">${inlineCell("A2", "1")}${inlineCell("B2", "2")}${inlineCell("C2", "3")}</row><row r="3"></row><row r="4">${inlineCell("A4", "4")}${inlineCell("C4", "6")}</row></sheetData></worksheet>`
  );
  const parsed = await parseDataImportBuffer({
    buffer: source,
    fileName: "headers.xlsx"
  });

  assert.deepEqual(parsed.headers, ["Код", "Колонка 2", "Код #2"]);
  assert.deepEqual(parsed.rows, [
    { "Код": "1", "Колонка 2": "2", "Код #2": "3" },
    { "Код": "4", "Колонка 2": "", "Код #2": "6" }
  ]);
  assert.deepEqual(parsed.sourceRowNumbers, [2, 4]);
});

test("CSV preserves the starting physical line of a quoted multiline record", async () => {
  const source = Buffer.from(
    'Код;ФИО;Примечание\r\nA-1;"ИВАНОВ ИВАН ИВАНОВИЧ";"Строка 1\r\nСтрока 2"\r\n\r\nA-2;Петров Пётр Петрович;Готово\r\n',
    "utf8"
  );
  const parsed = await parseDataImportBuffer({
    buffer: source,
    fileName: "employees.csv"
  });

  assert.equal(parsed.rows[0]?.["Примечание"], "Строка 1\nСтрока 2");
  assert.deepEqual(parsed.sourceRowNumbers, [2, 5]);
  assert.match(parsed.warnings.join(" "), /пустые строки/u);
});


test("legacy XLS is reported as a structured recoverable file error", async () => {
  const source = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
  await assert.rejects(
    () => parseDataImportBuffer({ buffer: source, fileName: "employees.xls" }),
    (error: unknown) => {
      assert.ok(error instanceof DataImportParseError);
      assert.equal(error.issue.code, "unsupported_legacy_xls");
      assert.equal(error.issue.scope, "file");
      assert.equal(error.issue.blockingEffect, "file");
      assert.match(error.issue.suggestedAction, /XLSX или CSV/u);
      return true;
    }
  );
});

test("renamed OLE XLS is detected by signature instead of extension", async () => {
  const source = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
  await assert.rejects(
    () => parseDataImportBuffer({ buffer: source, fileName: "employees.xlsx" }),
    (error: unknown) => {
      assert.ok(error instanceof DataImportParseError);
      assert.equal(error.issue.code, "unsupported_legacy_xls");
      return true;
    }
  );
});

test("invalid XLSX container has a stable file-level code", async () => {
  await assert.rejects(
    () =>
      parseDataImportBuffer({
        buffer: Buffer.from("not-a-zip", "utf8"),
        fileName: "employees.xlsx"
      }),
    (error: unknown) => {
      assert.ok(error instanceof DataImportParseError);
      assert.equal(error.issue.code, "xlsx_invalid_container");
      assert.match(error.issue.suggestedAction, /сохраните/u);
      return true;
    }
  );
});

test("single-column pasted table is accepted without an artificial delimiter error", async () => {
  const parsed = await parseDataImportBuffer({
    buffer: Buffer.from("ФИО\nИванов Иван Иванович\nПетров Пётр Петрович\n", "utf8"),
    fileName: "Вставленная таблица.csv"
  });
  assert.deepEqual(parsed.headers, ["ФИО"]);
  assert.equal(parsed.rowCount, 2);
  assert.deepEqual(parsed.sourceRowNumbers, [2, 3]);
});
