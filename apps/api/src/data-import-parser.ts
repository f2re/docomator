import { createHash } from "node:crypto";

import { parseCsvImport } from "./csv-import-parser.js";
import { parseXlsxImport } from "./xlsx-import-parser.js";

export interface ParsedDataImportTable {
  fileName: string;
  fileFormat: "csv" | "xlsx";
  sourceSha256: string;
  previewToken: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  sampleRows: Array<Record<string, string>>;
  rowCount: number;
  columnCount: number;
  warnings: string[];
}

export class DataImportParseError extends Error {
  override readonly name = "DataImportParseError";
}

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_COLUMNS = 100;
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
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceSha256: input.sourceSha256,
        headers: input.headers,
        rows: input.rows
      })
    )
    .digest("hex");
}

function buildTable(input: {
  fileName: string;
  fileFormat: "csv" | "xlsx";
  sourceSha256: string;
  matrix: readonly string[][];
  warnings: string[];
}): ParsedDataImportTable {
  const matrix = input.matrix
    .map((row) => row.map((value) => normalizeCell(value ?? "")))
    .filter((row) => row.some((value) => value.length > 0));
  if (matrix.length < 2) {
    throw new DataImportParseError(
      "Файл должен содержать строку заголовков и хотя бы одну строку данных."
    );
  }
  const width = Math.max(...matrix.map((row) => row.length));
  if (width < 1 || width > MAX_COLUMNS) {
    throw new DataImportParseError(
      `Файл должен содержать от 1 до ${MAX_COLUMNS} колонок.`
    );
  }
  const headers = uniqueHeaders(
    Array.from({ length: width }, (_item, index) => matrix[0]?.[index] ?? "")
  );
  const rows = matrix.slice(1).map((row) =>
    Object.fromEntries(
      headers.map((header, index) => [header, row[index] ?? ""])
    )
  );
  const previewToken = createImportPreviewToken({
    sourceSha256: input.sourceSha256,
    headers,
    rows
  });
  return {
    fileName: input.fileName,
    fileFormat: input.fileFormat,
    sourceSha256: input.sourceSha256,
    previewToken,
    headers,
    rows,
    sampleRows: rows.slice(0, 20),
    rowCount: rows.length,
    columnCount: headers.length,
    warnings: input.warnings
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
      matrix: parsed.matrix,
      warnings: [
        `Разделитель CSV: ${parsed.delimiter === "\t" ? "табуляция" : parsed.delimiter}`
      ]
    });
  }
  if (extension === "xlsx") {
    return buildTable({
      fileName,
      fileFormat: "xlsx",
      sourceSha256,
      matrix: await parseXlsxImport(buffer),
      warnings: ["Импортируется первый рабочий лист XLSX."]
    });
  }
  throw new DataImportParseError("Поддерживаются файлы CSV и XLSX.");
}
