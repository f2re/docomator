import assert from "node:assert/strict";
import test from "node:test";

import type {
  DocumentStructureReport,
  DocxParagraphElement,
  XlsxCellElement
} from "@docomator/document-intake";

import { proposeDataExtraction } from "./data-extraction-proposal.js";

function docxParagraph(
  id: string,
  index: number,
  text: string,
  tableIndex: number,
  rowIndex: number,
  columnIndex: number
): DocxParagraphElement {
  return {
    id,
    kind: "paragraph",
    part: "word/document.xml",
    index,
    text,
    runs: [],
    runsTruncated: false,
    tableLocation: { tableIndex, rowIndex, columnIndex }
  };
}

function docxReport(elements: DocxParagraphElement[]): DocumentStructureReport {
  return {
    fileName: "sample.docx",
    format: "docx",
    sourceSha256: "a".repeat(64),
    structureSha256: "b".repeat(64),
    truncated: false,
    summary: {
      partsRead: 1,
      paragraphs: elements.length,
      runs: 0,
      sheets: 0,
      cells: 0,
      formulas: 0,
      totalElements: elements.length,
      shownElements: elements.length
    },
    elements
  };
}

function xlsxCell(
  id: string,
  address: string,
  value: string,
  valueKind: XlsxCellElement["valueKind"] = "text"
): XlsxCellElement {
  return {
    id,
    kind: "cell",
    sheetName: "Лист1",
    sheetPath: "xl/worksheets/sheet1.xml",
    address,
    value,
    formula: null,
    valueKind
  };
}

function xlsxReport(elements: XlsxCellElement[]): DocumentStructureReport {
  return {
    fileName: "sample.xlsx",
    format: "xlsx",
    sourceSha256: "c".repeat(64),
    structureSha256: "d".repeat(64),
    truncated: false,
    summary: {
      partsRead: 2,
      paragraphs: 0,
      runs: 0,
      sheets: 1,
      cells: elements.length,
      formulas: 0,
      totalElements: elements.length,
      shownElements: elements.length
    },
    elements
  };
}

test("DOCX proposal finds a header row and starts repeat from the first data row", () => {
  const report = docxReport([
    docxParagraph("h1", 0, "№", 0, 0, 0),
    docxParagraph("h2", 1, "Наименование", 0, 0, 1),
    docxParagraph("h3", 2, "Срок", 0, 0, 2),
    docxParagraph("d11", 3, "1", 0, 1, 0),
    docxParagraph("d12", 4, "Подготовить доклад", 0, 1, 1),
    docxParagraph("d13", 5, "15.09.2026", 0, 1, 2),
    docxParagraph("d21", 6, "2", 0, 2, 0),
    docxParagraph("d22", 7, "Провести исследование", 0, 2, 1),
    docxParagraph("d23", 8, "01.12.2026", 0, 2, 2)
  ]);

  const proposal = proposeDataExtraction(report);
  assert.equal(proposal.repeat?.columns.length, 3);
  assert.deepEqual(
    proposal.repeat?.columns.map((column) => [column.label, column.elementId, column.outputType]),
    [
      ["№", "d11", "integer"],
      ["Наименование", "d12", "text"],
      ["Срок", "d13", "date"]
    ]
  );
  assert.equal(proposal.fields.length, 0);
  assert.ok(proposal.confidence >= 0.8);
});

test("DOCX proposal detects a two-column field-value card without treating it as a repeat table", () => {
  const report = docxReport([
    docxParagraph("l1", 0, "ФИО", 0, 0, 0),
    docxParagraph("v1", 1, "Иванов Иван Иванович", 0, 0, 1),
    docxParagraph("l2", 2, "Группа", 0, 1, 0),
    docxParagraph("v2", 3, "М-231", 0, 1, 1),
    docxParagraph("l3", 4, "Дата", 0, 2, 0),
    docxParagraph("v3", 5, "28.08.2026", 0, 2, 1)
  ]);

  const proposal = proposeDataExtraction(report);
  assert.equal(proposal.repeat, null);
  assert.deepEqual(
    proposal.fields.map((field) => [field.label, field.elementId, field.outputType]),
    [
      ["ФИО", "v1", "text"],
      ["Группа", "v2", "text"],
      ["Дата", "v3", "date"]
    ]
  );
});

test("XLSX proposal keeps cell coordinates and ignores formula cells as automatic columns", () => {
  const report = xlsxReport([
    xlsxCell("a1", "A1", "Код"),
    xlsxCell("b1", "B1", "Наименование"),
    xlsxCell("c1", "C1", "Сумма"),
    xlsxCell("a2", "A2", "101", "number"),
    xlsxCell("b2", "B2", "Первая запись"),
    xlsxCell("c2", "C2", "2500,50", "number"),
    xlsxCell("d2", "D2", "5001", "formula"),
    xlsxCell("a3", "A3", "102", "number"),
    xlsxCell("b3", "B3", "Вторая запись"),
    xlsxCell("c3", "C3", "3200", "number")
  ]);

  const proposal = proposeDataExtraction(report);
  assert.deepEqual(
    proposal.repeat?.columns.map((column) => [column.label, column.elementId, column.outputType]),
    [
      ["Код", "a2", "integer"],
      ["Наименование", "b2", "text"],
      ["Сумма", "c2", "number"]
    ]
  );
});

test("truncated structure fails safe and never creates an automatic plan", () => {
  const report = xlsxReport([xlsxCell("a1", "A1", "Название")]);
  report.truncated = true;
  const proposal = proposeDataExtraction(report);
  assert.equal(proposal.confidence, 0);
  assert.equal(proposal.fields.length, 0);
  assert.equal(proposal.repeat, null);
  assert.equal(proposal.warnings.length, 1);
});
