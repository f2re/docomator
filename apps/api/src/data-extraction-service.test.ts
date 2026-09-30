import assert from "node:assert/strict";
import test from "node:test";

import type { DocumentStructureReport } from "@docomator/document-intake";
import { toJsonValue } from "@docomator/storage";

import {
  applyExtractionCorrections,
  buildDataExtractionDefinition,
  dataExtractionCsv,
  extractDataFromStructure,
  validateExtractionCorrections
} from "./data-extraction-service.js";

function docxStructure(
  sourceKey: string,
  values: { number: string; rows: Array<[string, string]> }
): DocumentStructureReport {
  const elements: DocumentStructureReport["elements"] = [
    {
      id: `${sourceKey}-scalar`,
      kind: "paragraph",
      part: "word/document.xml",
      index: 0,
      text: values.number,
      runs: [],
      runsTruncated: false,
      tableLocation: null
    }
  ];
  values.rows.forEach((row, rowIndex) => {
    row.forEach((text, columnIndex) => {
      elements.push({
        id: `${sourceKey}-${rowIndex}-${columnIndex}`,
        kind: "paragraph",
        part: "word/document.xml",
        index: elements.length,
        text,
        runs: [],
        runsTruncated: false,
        tableLocation: { tableIndex: 0, rowIndex, columnIndex }
      });
    });
  });
  return {
    fileName: "source.docx",
    format: "docx",
    sourceSha256: sourceKey.padEnd(64, "a").slice(0, 64),
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

test("template uses structural DOCX coordinates across different source hashes", () => {
  const sample = docxStructure("sample", {
    number: "А-17",
    rows: [["Наименование", "Количество"], ["Деталь", "2"]]
  });
  const definition = buildDataExtractionDefinition(sample, {
    fields: [
      {
        label: "Номер документа",
        elementId: sample.elements[0]!.id,
        outputType: "text"
      }
    ],
    repeat: {
      label: "Позиции",
      columns: [
        { label: "Наименование", elementId: sample.elements[3]!.id },
        { label: "Количество", elementId: sample.elements[4]!.id, outputType: "integer" }
      ]
    }
  });

  const target = docxStructure("target", {
    number: "Б-21",
    rows: [
      ["Наименование", "Количество"],
      ["Болт", "3"],
      ["Гайка", "4"]
    ]
  });
  const extracted = extractDataFromStructure(target, definition);

  assert.equal(extracted.issues.length, 0);
  assert.equal(extracted.result.fields[0]?.value, "Б-21");
  assert.deepEqual(
    extracted.result.repeat?.rows.map((row) => row.cells.map((cell) => cell.value)),
    [["Болт", "3"], ["Гайка", "4"]]
  );
  assert.notEqual(sample.elements[0]?.id, target.elements[0]?.id);
});

test("conversion issues are structured and corrections never alter source result", () => {
  const sample = docxStructure("sample", {
    number: "10",
    rows: [["Позиция", "1"]]
  });
  const definition = buildDataExtractionDefinition(sample, {
    fields: [
      {
        label: "Количество",
        elementId: sample.elements[0]!.id,
        outputType: "integer"
      }
    ]
  });
  const target = docxStructure("target", { number: "десять", rows: [] });
  const extracted = extractDataFromStructure(target, definition);

  assert.equal(extracted.issues[0]?.code, "value_conversion_failed");
  assert.equal(extracted.issues[0]?.rawValue, "десять");
  assert.equal(extracted.issues[0]?.severity, "error");
  const fieldId = extracted.result.fields[0]!.fieldId;
  const corrections = validateExtractionCorrections(extracted.result, {
    fields: { [fieldId]: "10" },
    repeat: {}
  });
  const corrected = applyExtractionCorrections(extracted.result, corrections);
  assert.equal(extracted.result.fields[0]?.value, "десять");
  assert.equal(corrected.fields[0]?.value, "10");
});

test("CSV includes source document and repeats scalar values for table rows", () => {
  const sample = docxStructure("sample", {
    number: "A-1",
    rows: [["Болт", "2"], ["Гайка", "4"]]
  });
  const definition = buildDataExtractionDefinition(sample, {
    fields: [{ label: "Номер", elementId: sample.elements[0]!.id }],
    repeat: {
      columns: [
        { label: "Наименование", elementId: sample.elements[1]!.id },
        { label: "Количество", elementId: sample.elements[2]!.id }
      ]
    }
  });
  const extracted = extractDataFromStructure(sample, definition);
  const csv = dataExtractionCsv({
    templateSnapshot: toJsonValue(definition),
    items: [
      {
        sourceName: "Документ 1.docx",
        result: toJsonValue(extracted.result),
        corrections: {}
      }
    ]
  });

  assert.match(csv, /Исходный документ/u);
  assert.match(csv, /Документ 1\.docx/u);
  assert.match(csv, /№ строки/u);
  assert.match(csv, /Болт/u);
  assert.match(csv, /Гайка/u);
});
