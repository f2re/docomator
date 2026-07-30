import { strFromU8, unzipSync } from "fflate";

export interface AlignedXlsxImportTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

function xmlText(bytes: Uint8Array | undefined, path: string): string {
  if (!bytes) throw new Error(`В XLSX отсутствует обязательная часть ${path}.`);
  return strFromU8(bytes);
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/&#([0-9]+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function attribute(source: string, localName: string): string | null {
  const expression = new RegExp(
    `(?:^|\\s)(?:[A-Za-z_][\\w.-]*:)?${localName}\\s*=\\s*(["'])(.*?)\\1`,
    "u"
  );
  const match = expression.exec(source);
  return match?.[2] ? decodeXml(match[2]) : null;
}

function columnIndex(reference: string): number | null {
  const match = /^([A-Z]+)[0-9]+$/iu.exec(reference.trim());
  if (!match?.[1]) return null;
  let value = 0;
  for (const character of match[1].toLocaleUpperCase("en-US")) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value - 1;
}

function allTextNodes(xml: string): string {
  return [...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/gu)]
    .map((match) => decodeXml(match[1] ?? ""))
    .join("");
}

function sharedStrings(entries: Record<string, Uint8Array>): string[] {
  const bytes = entries["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const xml = strFromU8(bytes);
  return [...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/gu)].map(
    (match) => allTextNodes(match[1] ?? "")
  );
}

function relationshipTarget(
  entries: Record<string, Uint8Array>,
  relationshipId: string
): string | null {
  const relationships = entries["xl/_rels/workbook.xml.rels"];
  if (!relationships) return null;
  const xml = strFromU8(relationships);
  for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gu)) {
    const attributes = match[1] ?? "";
    if (attribute(attributes, "Id") !== relationshipId) continue;
    const target = attribute(attributes, "Target");
    if (!target) return null;
    const normalized = target.replace(/^\//u, "").replace(/^\.\//u, "");
    return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
  }
  return null;
}

function firstWorksheetPath(entries: Record<string, Uint8Array>): string {
  const workbook = xmlText(entries["xl/workbook.xml"], "xl/workbook.xml");
  const sheet = /<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/u.exec(workbook);
  const relationshipId = sheet?.[1]
    ? attribute(sheet[1], "id") ?? attribute(sheet[1], "r:id")
    : null;
  const related = relationshipId
    ? relationshipTarget(entries, relationshipId)
    : null;
  if (related && entries[related]) return related;
  const fallback = Object.keys(entries)
    .filter((path) => /^xl\/worksheets\/sheet[0-9]+\.xml$/u.test(path))
    .sort((left, right) => left.localeCompare(right, "en-US"))[0];
  if (!fallback) throw new Error("В XLSX не найден первый рабочий лист.");
  return fallback;
}

function cellValue(
  cellAttributes: string,
  cellXml: string,
  strings: readonly string[]
): string {
  const type = attribute(cellAttributes, "t") ?? "n";
  if (type === "inlineStr") return allTextNodes(cellXml);
  const valueMatch = /<(?:[A-Za-z_][\w.-]*:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/u.exec(
    cellXml
  );
  const raw = decodeXml(valueMatch?.[1] ?? "");
  if (type === "s") {
    const index = Number.parseInt(raw, 10);
    return Number.isInteger(index) && index >= 0 ? strings[index] ?? "" : "";
  }
  if (type === "b") return raw === "1" ? "true" : raw === "0" ? "false" : raw;
  if (type === "str" || type === "e" || type === "d") return raw;
  return raw;
}

function uniqueHeaders(values: readonly string[], width: number): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_unused, index) => {
    const source = (values[index] ?? "").normalize("NFKC").trim();
    const base = source || `Колонка ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function parseWorksheetRows(
  worksheet: string,
  strings: readonly string[]
): Array<{ rowNumber: number; values: string[] }> {
  const result: Array<{ rowNumber: number; values: string[] }> = [];
  let implicitRow = 0;
  for (const rowMatch of worksheet.matchAll(/<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>/gu)) {
    const rowAttributes = rowMatch[1] ?? "";
    const rowXml = rowMatch[2] ?? "";
    const explicitRow = Number.parseInt(attribute(rowAttributes, "r") ?? "", 10);
    const rowNumber = Number.isInteger(explicitRow) && explicitRow > 0
      ? explicitRow
      : implicitRow + 1;
    implicitRow = rowNumber;
    const values: string[] = [];
    let implicitColumn = 0;
    const cells = /<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>)/gu;
    for (const cellMatch of rowXml.matchAll(cells)) {
      const cellAttributes = cellMatch[1] ?? "";
      const reference = attribute(cellAttributes, "r") ?? "";
      const explicitColumn = columnIndex(reference);
      const index = explicitColumn ?? implicitColumn;
      while (values.length < index) values.push("");
      values[index] = cellValue(cellAttributes, cellMatch[2] ?? "", strings);
      implicitColumn = index + 1;
    }
    result.push({ rowNumber, values });
  }
  return result;
}

export function parseAlignedXlsxImport(
  input: Buffer | Uint8Array
): AlignedXlsxImportTable {
  const entries = unzipSync(
    input instanceof Uint8Array ? input : new Uint8Array(input)
  );
  const strings = sharedStrings(entries);
  const worksheetPath = firstWorksheetPath(entries);
  const worksheet = xmlText(entries[worksheetPath], worksheetPath);
  const physicalRows = parseWorksheetRows(worksheet, strings);
  const headerIndex = physicalRows.findIndex((row) =>
    row.values.some((value) => value.trim() !== "")
  );
  if (headerIndex < 0) {
    throw new Error("Первый лист XLSX не содержит строки заголовков.");
  }

  const dataRows = physicalRows.slice(headerIndex + 1);
  const width = Math.max(
    physicalRows[headerIndex]?.values.length ?? 0,
    ...dataRows.map((row) => row.values.length),
    0
  );
  if (width === 0) throw new Error("В XLSX не найдено колонок для импорта.");
  const headers = uniqueHeaders(physicalRows[headerIndex]?.values ?? [], width);
  const rows = dataRows
    .filter((row) => row.values.some((value) => value.trim() !== ""))
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, row.values[index] ?? ""])
      )
    );
  return { headers, rows };
}
