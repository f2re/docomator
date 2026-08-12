import { createHash } from "node:crypto";

import { dataImportOperationIssue, type DataImportOperationErrorCode, type DataImportOperationIssue } from "@docomator/storage";

import { CsvImportParseError, parseCsvImportRows, type ParsedCsvImportRow } from "./csv-import-parser.js";
import { XlsxImportParseError, parseXlsxImportRows, type ParsedXlsxImportRow } from "./xlsx-import-parser.js";

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
  readonly issue: DataImportOperationIssue;

  constructor(issueOrMessage: DataImportOperationIssue | string) {
    const issue = typeof issueOrMessage === "string"
      ? dataImportOperationIssue({
          code: "import_structure_invalid",
          scope: "file",
          blockingEffect: "file",
          message: issueOrMessage,
          suggestedAction: "Исправьте файл по описанию ошибки и повторите проверку; выбранные настройки импорта сохранены."
        })
      : issueOrMessage;
    super(issue.message);
    this.issue = issue;
  }
}

function parseFailure(
  code: DataImportOperationErrorCode,
  message: string,
  suggestedAction: string
): DataImportParseError {
  return new DataImportParseError(
    dataImportOperationIssue({
      code,
      scope: "file",
      blockingEffect: "file",
      message,
      suggestedAction
    })
  );
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
  if (buffer.length < 1) {
    throw parseFailure(
      "import_file_empty",
      "Файл импорта пуст.",
      "Выберите непустой CSV/XLSX."
    );
  }
  if (buffer.length > MAX_FILE_BYTES) {
    throw parseFailure(
      "import_file_too_large",
      "Файл импорта превышает допустимый размер 8 МБ.",
      "Уменьшите файл до 8 МБ или разделите данные на несколько импортов."
    );
  }
  const fileName = input.fileName.normalize("NFKC").trim();
  const extension = /\.([^.]+)$/u.exec(fileName)?.[1]?.toLowerCase();
  const sourceSha256 = createHash("sha256").update(buffer).digest("hex");
  const oleSignature =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    );

  if (extension === "xls" || oleSignature) {
    throw parseFailure(
      "unsupported_legacy_xls",
      "Этот файл сохранён в старом формате Excel 97–2003 (.xls).",
      "Откройте таблицу в Excel или LibreOffice, сохраните её как XLSX или CSV и загрузите снова. Сопоставления и введённые настройки не сбрасываются."
    );
  }

  if (extension === "csv") {
    try {
      const parsed = parseCsvImportRows(buffer);
      return buildTable({
        fileName,
        fileFormat: "csv",
        sourceSha256,
        sourceRows: parsed.rows,
        warnings: [
          `Разделитель CSV: ${parsed.delimiter === "\t" ? "табуляция" : parsed.delimiter}`
        ]
      });
    } catch (error) {
      if (error instanceof CsvImportParseError) {
        throw parseFailure(error.code, error.message, error.suggestedAction);
      }
      throw error;
    }
  }

  if (extension === "xlsx") {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw parseFailure(
        "xlsx_invalid_container",
        "Файл с расширением .xlsx не является книгой XLSX.",
        "Откройте исходный файл в Excel или LibreOffice и сохраните его как обычный XLSX."
      );
    }
    try {
      const parsed = await parseXlsxImportRows(buffer);
      return buildTable({
        fileName,
        fileFormat: "xlsx",
        sourceSha256,
        sourceRows: parsed.rows,
        warnings: parsed.warnings
      });
    } catch (error) {
      if (error instanceof XlsxImportParseError) {
        throw parseFailure(error.code, error.message, error.suggestedAction);
      }
      throw error;
    }
  }

  throw parseFailure(
    "unsupported_import_format",
    "Поддерживаются файлы CSV и XLSX.",
    "Выберите CSV/XLSX. Для старого .xls сначала сохраните таблицу как XLSX или CSV."
  );
}
