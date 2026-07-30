import path from "node:path";

import { readOoxmlPackage } from "@docomator/template-compiler";

export class XlsxImportParseError extends Error {
  override readonly name = "XlsxImportParseError";
}

export interface ParsedXlsxImportRow {
  rowNumber: number;
  cells: string[];
}

export interface ParsedXlsxImport {
  rows: ParsedXlsxImportRow[];
  warnings: string[];
}

const MAX_LOGICAL_ROWS = 1_001;
const MAX_COLUMNS = 100;
const MAX_EXCEL_ROW = 1_048_576;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function attribute(source: string, name: string): string | undefined {
  const escaped = escapeRegExp(name);
  const match = new RegExp(
    `(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "u"
  ).exec(source);
  return match?.[1] ?? match?.[2];
}

function textNodes(xml: string): string {
  return [
    ...xml.matchAll(
      /<(?:[A-Za-z_][\w.-]*:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/gu
    )
  ]
    .map((match) => xmlDecode(match[1] ?? ""))
    .join("");
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  return [
    ...xml.matchAll(
      /<(?:[A-Za-z_][\w.-]*:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/gu
    )
  ].map((match) => textNodes(match[1] ?? ""));
}

function parseStyles(xml: string | undefined): XlsxStyleTable {
  const customFormats = new Map<number, string>();
  const cellFormatIds: number[] = [];
  if (xml === undefined) return { customFormats, cellFormatIds };

  for (const match of xml.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?numFmt\b([^>]*)\/?\s*>/gu
  )) {
    const attributes = match[1] ?? "";
    const id = Number.parseInt(attribute(attributes, "numFmtId") ?? "", 10);
    const code = attribute(attributes, "formatCode");
    if (Number.isInteger(id) && code !== undefined) {
      customFormats.set(id, xmlDecode(code));
    }
  }

  const cellXfs = /<(?:[A-Za-z_][\w.-]*:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?cellXfs>/u.exec(xml)?.[1] ?? "";
  for (const match of cellXfs.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?xf\b([^>]*)\/?\s*>/gu
  )) {
    const id = Number.parseInt(attribute(match[1] ?? "", "numFmtId") ?? "0", 10);
    cellFormatIds.push(Number.isInteger(id) && id >= 0 ? id : 0);
  }
  return { customFormats, cellFormatIds };
}

function columnIndex(reference: string): number {
  const letters = /^\$?([A-Z]+)/u.exec(reference.toUpperCase())?.[1];
  if (!letters) return -1;
  let result = 0;
  for (const character of letters) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result - 1;
}

function rowIndex(reference: string): number {
  const digits = /\$?(\d+)$/u.exec(reference)?.[1];
  if (digits === undefined) return -1;
  const value = Number.parseInt(digits, 10);
  return Number.isInteger(value) && value >= 1 && value <= MAX_EXCEL_ROW
    ? value
    : -1;
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
  const raw = /<(?:[A-Za-z_][\w.-]*:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/u.exec(cellXml)?.[1] ?? "";
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

function relationshipTargets(xml: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (xml === undefined) return result;
  for (const match of xml.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gu
  )) {
    const attributes = match[1] ?? "";
    const id = attribute(attributes, "Id");
    const target = attribute(attributes, "Target");
    const type = attribute(attributes, "Type") ?? "";
    if (id !== undefined && target !== undefined && /\/worksheet$/u.test(type)) {
      result.set(id, target);
    }
  }
  return result;
}

function normalizedWorksheetTarget(target: string): string {
  const portable = target.replaceAll("\\", "/");
  if (portable.startsWith("/")) return portable.slice(1);
  return path.posix.normalize(path.posix.join("xl", portable));
}

function firstWorksheetName(byName: ReadonlyMap<string, string>): string | undefined {
  const workbook = byName.get("xl/workbook.xml") ?? "";
  const targets = relationshipTargets(byName.get("xl/_rels/workbook.xml.rels"));
  const sheets = [
    ...workbook.matchAll(
      /<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/gu
    )
  ].map((match) => match[1] ?? "");
  const visible = sheets.find((attributes) => {
    const state = attribute(attributes, "state");
    return state !== "hidden" && state !== "veryHidden";
  }) ?? sheets[0];
  if (visible !== undefined) {
    const relationshipId = attribute(visible, "r:id");
    const target = relationshipId === undefined ? undefined : targets.get(relationshipId);
    if (target !== undefined) {
      const normalized = normalizedWorksheetTarget(target);
      if (byName.has(normalized)) return normalized;
    }
  }
  return [...byName.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort((left, right) => {
      const leftNumber = Number(/sheet(\d+)/u.exec(left)?.[1] ?? 0);
      const rightNumber = Number(/sheet(\d+)/u.exec(right)?.[1] ?? 0);
      return leftNumber - rightNumber;
    })[0];
}

function parseWorksheetRows(input: {
  xml: string;
  sharedStrings: readonly string[];
  styles: XlsxStyleTable;
  date1904: boolean;
}): ParsedXlsxImportRow[] {
  const rows: ParsedXlsxImportRow[] = [];
  let implicitRowNumber = 0;
  for (const rowMatch of input.xml.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>/gu
  )) {
    const rowAttributes = rowMatch[1] ?? "";
    const rowXml = rowMatch[2] ?? "";
    const explicitRowNumber = Number.parseInt(attribute(rowAttributes, "r") ?? "", 10);
    const sourceRowNumber =
      Number.isInteger(explicitRowNumber) &&
      explicitRowNumber >= 1 &&
      explicitRowNumber <= MAX_EXCEL_ROW
        ? explicitRowNumber
        : implicitRowNumber + 1;
    implicitRowNumber = sourceRowNumber;
    const cells: string[] = [];
    let nextColumn = 0;
    for (const cellMatch of rowXml.matchAll(
      /<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>)/gu
    )) {
      const attributes = cellMatch[1] ?? "";
      const cellXml = cellMatch[2] ?? "";
      const reference = attribute(attributes, "r");
      const explicitColumn = reference === undefined ? -1 : columnIndex(reference);
      const explicitRow = reference === undefined ? -1 : rowIndex(reference);
      if (explicitRow > 0 && explicitRow !== sourceRowNumber) {
        throw new XlsxImportParseError(
          `Ячейка «${reference}» записана внутри строки ${sourceRowNumber}. Исправьте структуру XLSX.`
        );
      }
      const index = explicitColumn >= 0 ? explicitColumn : nextColumn;
      const value = cellValue(
        cellXml,
        attributes,
        input.sharedStrings,
        input.styles,
        input.date1904
      );
      if (index >= MAX_COLUMNS) {
        if (value.trim().length > 0) {
          throw new XlsxImportParseError(
            "XLSX содержит данные правее 100-й колонки."
          );
        }
        nextColumn = index + 1;
        continue;
      }
      cells[index] = value;
      nextColumn = index + 1;
    }
    if (cells.length > 0) rows.push({ rowNumber: sourceRowNumber, cells });
  }
  return rows;
}

export async function parseXlsxImport(buffer: Uint8Array): Promise<ParsedXlsxImport> {
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
  const date1904 = /<(?:[A-Za-z_][\w.-]*:)?workbookPr\b[^>]*\bdate1904="(?:1|true)"/iu.test(
    byName.get("xl/workbook.xml") ?? ""
  );
  const sheetName = firstWorksheetName(byName);
  if (sheetName === undefined) {
    throw new XlsxImportParseError("В XLSX не найден рабочий лист.");
  }

  const xml = byName.get(sheetName) ?? "";
  const rows = parseWorksheetRows({ xml, sharedStrings, styles, date1904 });
  const nonEmptyCount = rows.filter((row) =>
    row.cells.some((value) => String(value ?? "").trim().length > 0)
  ).length;
  if (nonEmptyCount > MAX_LOGICAL_ROWS) {
    throw new XlsxImportParseError(
      "XLSX содержит более 1000 строк данных."
    );
  }
  const warnings = ["Импортируется первый видимый рабочий лист XLSX."];
  if (/<(?:[A-Za-z_][\w.-]*:)?mergeCell\b/iu.test(xml)) {
    warnings.push(
      "В листе есть объединённые ячейки: значение берётся из их верхней левой ячейки, остальные позиции остаются пустыми."
    );
  }
  return { rows, warnings };
}
