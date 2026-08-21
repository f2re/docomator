export type CsvImportParseErrorCode =
  | "csv_invalid_encoding"
  | "csv_unclosed_quote"
  | "csv_too_many_rows";

export class CsvImportParseError extends Error {
  override readonly name = "CsvImportParseError";

  constructor(
    readonly code: CsvImportParseErrorCode,
    message: string,
    readonly suggestedAction: string
  ) {
    super(message);
  }
}

export interface ParsedCsvImportRow {
  rowNumber: number;
  cells: string[];
}

export interface ParsedCsvImport {
  rows: ParsedCsvImportRow[];
  delimiter: string;
}

const MAX_LOGICAL_ROWS = 1_001;

function countDelimiter(record: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < record.length; index += 1) {
    const character = record[index];
    if (character === '"') {
      if (quoted && record[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      count += 1;
    }
  }
  return count;
}

function sampleLogicalRecords(text: string, maxRecords = 10): string[] {
  const records: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      const record = text.slice(start, index).trim();
      if (record.length > 0) {
        records.push(record);
        if (records.length >= maxRecords) return records;
      }
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      start = index + 1;
    }
  }
  const remaining = text.slice(start).trim();
  if (remaining.length > 0) records.push(remaining);
  return records;
}

function detectCsvDelimiter(text: string): string {
  const records = sampleLogicalRecords(text, 10);
  if (records.length === 0) return "\t";

  const firstRecord = records[0]!;
  const tabCount = countDelimiter(firstRecord, "\t");
  const semicolonCount = countDelimiter(firstRecord, ";");
  const commaCount = countDelimiter(firstRecord, ",");

  if (tabCount > 0) {
    const tabCounts = records.map((r) => countDelimiter(r, "\t"));
    const consistentTabs = tabCounts.every((c) => c === tabCount);
    if (consistentTabs || tabCount >= Math.max(semicolonCount, commaCount)) {
      return "\t";
    }
  }

  const candidates = [";", ",", "\t"] as const;
  const scored = candidates.map((candidate) => {
    const counts = records.map((r) => countDelimiter(r, candidate));
    const first = counts[0] ?? 0;
    if (first === 0) return { candidate, score: -1 };
    const consistent = counts.every((c) => c === first);
    const weight = candidate === ";" ? 3 : candidate === "," ? 2 : 1;
    return {
      candidate,
      score: (consistent ? 1000 : 0) + first * 10 + weight
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score && scored[0].score > 0 ? scored[0].candidate : "\t";
}

export function parseCsvImportRows(buffer: Uint8Array): ParsedCsvImport {
  let text = Buffer.from(buffer).toString("utf8");
  if (text.startsWith("\ufeff")) text = text.slice(1);
  if (text.includes("\ufffd")) {
    throw new CsvImportParseError(
      "csv_invalid_encoding",
      "CSV должен быть сохранён в кодировке UTF-8.",
      "Сохраните таблицу как CSV UTF-8 или как XLSX и выберите файл снова."
    );
  }

  const delimiterCandidate = detectCsvDelimiter(text);
  const delimiter = { candidate: delimiterCandidate, count: 0 };

  const rows: ParsedCsvImportRow[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let physicalLine = 1;
  let rowStartLine = 1;

  const finishRow = () => {
    row.push(field);
    field = "";
    rows.push({ rowNumber: rowStartLine, cells: row });
    row = [];
    if (rows.length > MAX_LOGICAL_ROWS) {
      throw new CsvImportParseError(
        "csv_too_many_rows",
        "CSV содержит более 1000 строк данных.",
        "Разделите таблицу на несколько файлов не более чем по 1000 строк данных."
      );
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        field += "\n";
        physicalLine += 1;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === delimiter.candidate) {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
      physicalLine += 1;
      rowStartLine = physicalLine;
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new CsvImportParseError(
      "csv_unclosed_quote",
      "В CSV не закрыта кавычка поля.",
      "Исправьте кавычки в исходном CSV либо сохраните диапазон заново из Excel/LibreOffice."
    );
  }
  if (field.length > 0 || row.length > 0) {
    finishRow();
  }

  return { rows, delimiter: delimiter.candidate };
}

export function parseCsvImport(buffer: Uint8Array): string[][] {
  return parseCsvImportRows(buffer).rows.map((row) => row.cells);
}
