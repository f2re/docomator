export class CsvImportParseError extends Error {
  override readonly name = "CsvImportParseError";
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

function firstLogicalRecord(text: string): string {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      const record = text.slice(0, index);
      if (record.trim().length > 0) return record;
      const next = character === "\r" && text[index + 1] === "\n" ? index + 2 : index + 1;
      return firstLogicalRecord(text.slice(next));
    }
  }
  return text;
}

export function parseCsvImportRows(buffer: Uint8Array): ParsedCsvImport {
  let text = Buffer.from(buffer).toString("utf8");
  if (text.startsWith("\ufeff")) text = text.slice(1);
  if (text.includes("\ufffd")) {
    throw new CsvImportParseError(
      "CSV должен быть сохранён в кодировке UTF-8."
    );
  }

  const firstRecord = firstLogicalRecord(text);
  const delimiter = [";", ",", "\t"]
    .map((candidate) => ({
      candidate,
      count: countDelimiter(firstRecord, candidate)
    }))
    .sort((left, right) => right.count - left.count)[0];
  if (delimiter === undefined || delimiter.count < 1) {
    throw new CsvImportParseError(
      "Не удалось определить разделитель CSV. Используйте точку с запятой, запятую или табуляцию."
    );
  }

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
        "CSV содержит более 1000 строк данных."
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
    throw new CsvImportParseError("В CSV не закрыта кавычка поля.");
  }
  if (field.length > 0 || row.length > 0) {
    finishRow();
  }

  return { rows, delimiter: delimiter.candidate };
}

export function parseCsvImport(buffer: Uint8Array): string[][] {
  return parseCsvImportRows(buffer).rows.map((row) => row.cells);
}
