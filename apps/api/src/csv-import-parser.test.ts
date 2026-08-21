import assert from "node:assert/strict";
import test from "node:test";

import { parseCsvImportRows, CsvImportParseError } from "./csv-import-parser.js";

test("detects tab delimiter in Excel paste even when headers contain commas and semicolons", () => {
  const tsv = "ФИО, статус\tДолжность; отдел\tТабельный номер, код\nИванов Иван\tИнженер\t1042\nПетрова Анна\tБухгалтер\t1043";
  const result = parseCsvImportRows(Buffer.from(tsv, "utf8"));
  assert.equal(result.delimiter, "\t");
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows[0]?.cells, ["ФИО, статус", "Должность; отдел", "Табельный номер, код"]);
  assert.deepEqual(result.rows[1]?.cells, ["Иванов Иван", "Инженер", "1042"]);
});

test("detects semicolon delimiter in standard Russian CSV", () => {
  const csv = "ФИО;Должность;Табельный номер\nИванов Иван;Инженер;1042\nПетрова Анна;Бухгалтер;1043";
  const result = parseCsvImportRows(Buffer.from(csv, "utf8"));
  assert.equal(result.delimiter, ";");
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows[0]?.cells, ["ФИО", "Должность", "Табельный номер"]);
});

test("handles UTF-8 BOM in CSV/TSV data", () => {
  const csv = "\uFEFFФИО,Должность\nИванов,Инженер";
  const result = parseCsvImportRows(Buffer.from(csv, "utf8"));
  assert.equal(result.rows[0]?.cells[0], "ФИО");
});

test("parses multiline quoted fields and escaped quotes in CSV", () => {
  const csv = 'ФИО,Примечание\nИванов,"Строка 1\nСтрока 2"\nПетров,"Инженер ""АСУ"""';
  const result = parseCsvImportRows(Buffer.from(csv, "utf8"));
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[1]?.cells[1], "Строка 1\nСтрока 2");
  assert.equal(result.rows[2]?.cells[1], 'Инженер "АСУ"');
});

test("rejects unclosed quote in CSV", () => {
  const csv = 'ФИО,Примечание\nИванов,"Не закрытая кавычка';
  assert.throws(
    () => parseCsvImportRows(Buffer.from(csv, "utf8")),
    (error: unknown) => error instanceof CsvImportParseError && error.code === "csv_unclosed_quote"
  );
});
