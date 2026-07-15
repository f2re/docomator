export class CsvImportParseError extends Error {
  override readonly name = "CsvImportParseError";
}

const MAX_ROWS = 1_001;

function countDelimiter(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      count += 1;
    }
  }
  return count;
}

export function parseCsvImport(buffer: Uint8Array): {
  matrix: string[][];
  delimiter: string;
} {
  let text = Buffer.from(buffer).toString("utf8");
  if (text.startsWith("\ufeff")) text = text.slice(1);
  if (text.includes("\ufffd")) {
    throw new CsvImportParseError(
      "CSV должен быть сохранён в кодировке UTF-8."
    );
  }

  const firstLine = text.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? "";
  const delimiter = [";", ",", "\t"]
    .map((candidate) => ({
      candidate,
      count: countDelimiter(firstLine, candidate)
    }))
    .sort((left, right) => right.count - left.count)[0];
  if (delimiter === undefined || delimiter.count < 1) {
    throw new CsvImportParseError(
      "Не удалось определить разделитель CSV. Используйте точку с запятой, запятую или табуляцию."
    );
  }

  const matrix: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
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
      row.push(field);
      field = "";
      matrix.push(row);
      row = [];
      if (matrix.length > MAX_ROWS + 1) {
        throw new CsvImportParseError(
          "CSV содержит более 1000 строк данных."
        );
      }
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new CsvImportParseError("В CSV не закрыта кавычка поля.");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    matrix.push(row);
  }

  return { matrix, delimiter: delimiter.candidate };
}
