import { createHash } from "node:crypto";

import { parseCsvImport, type ParsedCsvImportRow } from "./csv-import-parser.js";
import { parseXlsxImport, type ParsedXlsxImportRow } from "./xlsx-import-parser.js";

export interface ParsedDataImportTable {
  fileName: string;
  fileFormat: "csv" | "xlsx";
  sourceSha256: string;
  previewToken: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  sourceRowNumbers: number[];
  sampleRows: Array<Record<string, string>>;
  sampleRowNumbers: number[];
  rowCount: number;
  columnCount: number;
  warnings: string[];
}

export class DataImportParseError extends Error {
  override readonly name = "DataImportParseError";
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_COLUMNS = 100;
const MAX_DATA_ROWS = 1_000;
const MAX_CELL_CHARS = 20_000;

function normalizeCell(value: string): string {
  const normalized = value
    .replace(/\r\n?/gu, "\n")
    .normalize("NFKC")
    .trim();
  if (normalized.length > MAX_CELL_CHARS || /\u0000/u.test(normalized)) {
    throw new DataImportParseError(
      "В файле найдено слишком длинное или недопустимое значение ячейки."
    );
  }
  return normalized;
}

function uniqueHeaders(values: readonly string[]): string[] {
  const used = new Map<string, number>();
  return values.map((value, index) => {
    const base = normalizeCell(value) || `Колонка ${index + 1}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base} #${count}`;
  });
}

export function createImportPreviewToken(input: {
  sourceSha256: string;
  headers: readonly string[];
  rows: readonly Record<string, string>[];
  sourceRowNumbers?: readonly number[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceSha256: input.sourceSha256,
        headers: input.headers,
        rows: input.rows,
        sourceRowNumbers:
          input.sourceRowNumbers ?? input.rows.map((_row, index) => index + 2)
      })
    )
    .digest("hex");
}

function buildTable(input: {
  fileName: string;
  fileFormat: "csv" | "xlsx";
  sourceSha256: string;
  sourceRows: readonly (ParsedCsvImportRow | ParsedXlsxImportRow)[];
  warnings: string[];
}): ParsedDataImportTable {
  const normalizedRows = input.sourceRows.map((row) => ({
    rowNumber: row.rowNumber,
    cells: row.cells.map((value) => normalizeCell(value ?? ""))
  }));
  const populatedRows = normalizedRows.filter((row) =>
    row.cells.some((value) => value.length > 0)
  );
  if (populatedRows.length < 2) {
    throw new DataImportParseError(
      "Файл должен содержать строку заголовков и хотя бы одну строку данных."
    );
  }
  const headerRow = populatedRows[0];
  if (headerRow === undefined) {
    throw new DataImportParseError("В файле не найдена строка заголовков.");
  }
  const dataRows = populatedRows.slice(1);
  if (dataRows.length > MAX_DATA_ROWS) {
    throw new DataImportParseError(
      `Файл содержит более ${MAX_DATA_ROWS} строк данных.`
    );
  }
  const width = Math.max(
    headerRow.cells.length,
    ...dataRows.map((row) => row.cells.length)
  );
  if (width < 1 || width > MAX_COLUMNS) {
    throw new DataImportParseError(
      `Файл должен содержать от 1 до ${MAX_COLUMNS} колонок.`
    );
  }
  const headers = uniqueHeaders(
    Array.from({ length: width }, (_item, index) => headerRow.cells[index] ?? "")
  );
  const rows = dataRows.map((row) =>
    Object.fromEntries(
      headers.map((header, index) => [header, row.cells[index] ?? ""])
    )
  );
  const sourceRowNumbers = dataRows.map((row) => row.rowNumber);
  const skippedBlankRows = Math.max(
    0,
    normalizedRows.filter((row) => row.rowNumber > headerRow.rowNumber).length -
      dataRows.length
  );
  const warnings = [...input.warnings];
  if (headerRow.rowNumber > 1) {
    warnings.push(
      `Строка заголовков найдена в строке ${headerRow.rowNumber}; предыдущие пустые строки пропущены.`
    );
  }
  if (skippedBlankRows > 0) {
    warnings.push(
      `Полностью пустые строки пропущены: ${skippedBlankRows}. Номера остальных строк сохранены.`
    );
  }
  const previewToken = createImportPreviewToken({
    sourceSha256: input.sourceSha256,
    headers,
    rows,
    sourceRowNumbers
  });
  return {
    fileName: input.fileName,
    fileFormat: input.fileFormat,
    sourceSha256: input.sourceSha256,
    previewToken,
    headers,
    rows,
    sourceRowNumbers,
    sampleRows: rows.slice(0, 20),
    sampleRowNumbers: sourceRowNumbers.slice(0, 20),
    rowCount: rows.length,
    columnCount: headers.length,
    warnings
  };
}

export async function parseDataImportBuffer(input: {
  buffer: Uint8Array;
  fileName: string;
}): Promise<ParsedDataImportTable> {
  const buffer = Buffer.from(input.buffer);
  if (buffer.length < 1 || buffer.length > MAX_FILE_BYTES) {
    throw new DataImportParseError(
      "Файл импорта должен иметь размер от 1 байта до 8 МБ."
    );
  }
  const fileName = input.fileName.normalize("NFKC").trim();
  const extension = /\.([^.]+)$/u.exec(fileName)?.[1]?.toLowerCase();
  const sourceSha256 = createHash("sha256").update(buffer).digest("hex");
  if (extension === "csv") {
    const parsed = parseCsvImport(buffer);
    return buildTable({
      fileName,
      fileFormat: "csv",
      sourceSha256,
      sourceRows: parsed.rows,
      warnings: [
        `Разделитель CSV: ${parsed.delimiter === "\t" ? "табуляция" : parsed.delimiter}`
      ]
    });
  }
  if (extension === "xlsx") {
    const parsed = await parseXlsxImport(buffer);
    return buildTable({
      fileName,
      fileFormat: "xlsx",
      sourceSha256,
      sourceRows: parsed.rows,
      warnings: parsed.warnings
    });
  }
  throw new DataImportParseError("Поддерживаются файлы CSV и XLSX.");
}
