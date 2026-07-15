import { readOoxmlPackage } from "@docomator/template-compiler";

export class XlsxImportParseError extends Error {
  override readonly name = "XlsxImportParseError";
}

const MAX_ROWS = 1_001;
const MAX_COLUMNS = 100;

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

function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/u.exec(reference.toUpperCase())?.[1];
  if (!letters) return -1;
  let result = 0;
  for (const character of letters) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result - 1;
}

function cellValue(
  cellXml: string,
  attributes: string,
  sharedStrings: readonly string[]
): string {
  const type = /\bt="([^"]+)"/u.exec(attributes)?.[1] ?? "n";
  if (type === "inlineStr") return textNodes(cellXml);
  const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/u.exec(cellXml)?.[1] ?? "";
  const decoded = xmlDecode(raw);
  if (type === "s") {
    const index = Number.parseInt(decoded, 10);
    return Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
  }
  if (type === "b") return decoded === "1" ? "Да" : "Нет";
  return decoded;
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
    row[colIndex] = cellValue(cellXml, attributes, sharedStrings);
    matrix[rowIndex] = row;
  }
  return matrix;
}
