import { readOoxmlPackage } from "@docomator/template-compiler";

export class XlsxImportParseError extends Error {
  override readonly name = "XlsxImportParseError";
}

const MAX_ROWS = 1_001;
const MAX_COLUMNS = 100;
const EXCEL_DAY_MILLISECONDS = 86_400_000;
const BUILTIN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  50, 51, 52, 53, 54, 55, 56, 57, 58
]);
const BUILTIN_DATE_TIME_FORMAT_IDS = new Set([22]);

interface XlsxStyleTable {
  customFormats: Map<number, string>;
  cellFormatIds: number[];
}

function xmlDecode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/gu, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function attribute(source: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`, "u").exec(source)?.[1];
}

function textNodes(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)]
    .map((match) => xmlDecode(match[1] ?? ""))
    .join("");
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gu)].map(
    (match) => textNodes(match[1] ?? "")
  );
}

function parseStyles(xml: string | undefined): XlsxStyleTable {
  const customFormats = new Map<number, string>();
  const cellFormatIds: number[] = [];
  if (xml === undefined) return { customFormats, cellFormatIds };

  for (const match of xml.matchAll(/<numFmt\b([^>]*)\/?\s*>/gu)) {
    const attributes = match[1] ?? "";
    const id = Number.parseInt(attribute(attributes, "numFmtId") ?? "", 10);
    const code = attribute(attributes, "formatCode");
    if (Number.isInteger(id) && code !== undefined) {
      customFormats.set(id, xmlDecode(code));
    }
  }

  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/u.exec(xml)?.[1] ?? "";
  for (const match of cellXfs.matchAll(/<xf\b([^>]*)\/?\s*>/gu)) {
    const id = Number.parseInt(attribute(match[1] ?? "", "numFmtId") ?? "0", 10);
    cellFormatIds.push(Number.isInteger(id) && id >= 0 ? id : 0);
  }
  return { customFormats, cellFormatIds };
}

function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/u.exec(reference.toUpperCase())?.[1];
  if (!letters) return -1;
  let result = 0;
  for (const character of letters) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result - 1;
}

function normalizedFormatCode(value: string): string {
  return value
    .replace(/"[^"]*"/gu, "")
    .replace(/\\./gu, "")
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/_.|\*./gu, "")
    .toLocaleLowerCase("en-US");
}

function dateFormatKind(
  formatId: number,
  customFormat: string | undefined
): "date" | "date-time" | null {
  if (BUILTIN_DATE_TIME_FORMAT_IDS.has(formatId)) return "date-time";
  if (BUILTIN_DATE_FORMAT_IDS.has(formatId)) return "date";
  if (customFormat === undefined) return null;
  const normalized = normalizedFormatCode(customFormat);
  const hasDate = /[dy]/u.test(normalized);
  if (!hasDate) return null;
  return /[hs]/u.test(normalized) ? "date-time" : "date";
}

function excelSerialDate(
  raw: string,
  date1904: boolean,
  kind: "date" | "date-time"
): string | null {
  const serial = Number(raw);
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;
  let milliseconds: number;
  if (date1904) {
    milliseconds = Date.UTC(1904, 0, 1) + wholeDays * EXCEL_DAY_MILLISECONDS;
  } else {
    if (wholeDays === 60) return null;
    const adjustedDays = wholeDays > 60 ? wholeDays - 1 : wholeDays;
    milliseconds = Date.UTC(1899, 11, 31) + adjustedDays * EXCEL_DAY_MILLISECONDS;
  }
  milliseconds += Math.round(fraction * EXCEL_DAY_MILLISECONDS);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return kind === "date" ? date.toISOString().slice(0, 10) : date.toISOString();
}

function readableNumberMask(formatCode: string): string | null {
  const source = formatCode.split(";", 1)[0] ?? "";
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (character === '"') {
      const end = source.indexOf('"', index + 1);
      if (end < 0) return null;
      result += source.slice(index + 1, end);
      index = end;
      continue;
    }
    if (character === "\\") {
      const literal = source[index + 1];
      if (literal === undefined) return null;
      result += literal;
      index += 1;
      continue;
    }
    if (character === "_") {
      if (source[index + 1] !== undefined) index += 1;
      result += " ";
      continue;
    }
    if (character === "*") {
      if (source[index + 1] !== undefined) index += 1;
      continue;
    }
    if (character === "[") {
      const end = source.indexOf("]", index + 1);
      if (end < 0) return null;
      index = end;
      continue;
    }
    result += character;
  }
  return result.trim();
}

function formatZeroMask(raw: string, formatCode: string | undefined): string | null {
  if (formatCode === undefined || !/^\d+(?:\.0+)?$/u.test(raw)) return null;
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < 0) return null;
  const mask = readableNumberMask(formatCode);
  if (
    mask === null ||
    !mask.includes("0") ||
    /[#?@%a-z]/iu.test(mask) ||
    !/^[0\s().+\-/]+$/u.test(mask)
  ) {
    return null;
  }
  const count = [...mask].filter((character) => character === "0").length;
  const digits = String(number);
  if (count < 1 || digits.length > count) return null;
  const padded = digits.padStart(count, "0");
  let position = 0;
  return [...mask]
    .map((character) =>
      character === "0" ? padded[position++] ?? "0" : character
    )
    .join("");
}

function cellValue(
  cellXml: string,
  attributes: string,
  sharedStrings: readonly string[],
  styles: XlsxStyleTable,
  date1904: boolean
): string {
  const type = attribute(attributes, "t") ?? "n";
  if (type === "inlineStr") return textNodes(cellXml);
  const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/u.exec(cellXml)?.[1] ?? "";
  const decoded = xmlDecode(raw);
  if (type === "s") {
    const index = Number.parseInt(decoded, 10);
    return Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
  }
  if (type === "b") return decoded === "1" ? "Да" : "Нет";
  if (type === "d" || type === "str" || type !== "n") return decoded;

  const styleIndex = Number.parseInt(attribute(attributes, "s") ?? "0", 10);
  const formatId = Number.isInteger(styleIndex) && styleIndex >= 0
    ? styles.cellFormatIds[styleIndex] ?? 0
    : 0;
  const customFormat = styles.customFormats.get(formatId);
  const kind = dateFormatKind(formatId, customFormat);
  if (kind !== null) {
    return excelSerialDate(decoded, date1904, kind) ?? decoded;
  }
  return formatZeroMask(decoded, customFormat) ?? decoded;
}

export async function parseXlsxImport(buffer: Uint8Array): Promise<string[][]> {
  const entries = await readOoxmlPackage(buffer, {
    maxEntries: 512,
    maxEntryBytes: 8 * 1024 * 1024,
    maxTotalBytes: 32 * 1024 * 1024
  });
  if (
    entries.some((entry) =>
      /(?:vbaProject\.bin|activeX\/|embeddings\/|externalLinks\/)/iu.test(
        entry.name
      )
    )
  ) {
    throw new XlsxImportParseError(
      "Для импорта нужен обычный XLSX без макросов, встроенных объектов и внешних связей."
    );
  }

  const byName = new Map(
    entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => [entry.name, entry.content.toString("utf8")])
  );
  const sharedStrings = parseSharedStrings(byName.get("xl/sharedStrings.xml"));
  const styles = parseStyles(byName.get("xl/styles.xml"));
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/iu.test(
    byName.get("xl/workbook.xml") ?? ""
  );
  const sheetName = [...byName.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort((left, right) => {
      const leftNumber = Number(/sheet(\d+)/u.exec(left)?.[1] ?? 0);
      const rightNumber = Number(/sheet(\d+)/u.exec(right)?.[1] ?? 0);
      return leftNumber - rightNumber;
    })[0];
  if (sheetName === undefined) {
    throw new XlsxImportParseError("В XLSX не найден рабочий лист.");
  }

  const matrix: string[][] = [];
  const xml = byName.get(sheetName) ?? "";
  for (const match of xml.matchAll(
    /<c\b([^>]*\br="([A-Z]+\d+)"[^>]*)>([\s\S]*?)<\/c>/gu
  )) {
    const attributes = match[1] ?? "";
    const reference = match[2] ?? "";
    const cellXml = match[3] ?? "";
    const rowIndex = Number.parseInt(/(\d+)$/u.exec(reference)?.[1] ?? "0", 10) - 1;
    const colIndex = columnIndex(reference);
    if (rowIndex < 0 || colIndex < 0) continue;
    if (rowIndex >= MAX_ROWS || colIndex >= MAX_COLUMNS) {
      throw new XlsxImportParseError(
        "XLSX превышает предел 1000 строк данных или 100 колонок."
      );
    }
    const row = matrix[rowIndex] ?? [];
    row[colIndex] = cellValue(cellXml, attributes, sharedStrings, styles, date1904);
    matrix[rowIndex] = row;
  }
  return matrix;
}
