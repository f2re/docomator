import { createHash } from "node:crypto";
import path from "node:path";

import yauzl, { type Entry, type ZipFile } from "yauzl";

import {
  DEFAULT_INTAKE_LIMITS,
  DocumentIntakeError,
  inspectOoxmlBuffer,
  type DocumentFormat,
  type InspectOoxmlInput
} from "./intake.js";

export interface DocumentStructureLimits {
  maxElements: number;
  maxXmlPartBytes: number;
  maxRunsPerParagraph: number;
}

export const DEFAULT_STRUCTURE_LIMITS: Readonly<DocumentStructureLimits> =
  Object.freeze({
    maxElements: 300,
    maxXmlPartBytes: 16 * 1024 * 1024,
    maxRunsPerParagraph: 500
  });

export interface DocxTableLocation {
  tableIndex: number;
  rowIndex: number;
  columnIndex: number;
}

export interface DocxRunElement {
  id: string;
  kind: "run";
  part: string;
  paragraphIndex: number;
  runIndex: number;
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface DocxParagraphElement {
  id: string;
  kind: "paragraph";
  part: string;
  index: number;
  text: string;
  runs: DocxRunElement[];
  runsTruncated: boolean;
  tableLocation: DocxTableLocation | null;
}

export type XlsxCellValueKind =
  | "blank"
  | "text"
  | "number"
  | "boolean"
  | "error"
  | "formula";

export interface XlsxCellElement {
  id: string;
  kind: "cell";
  sheetName: string;
  sheetPath: string;
  address: string;
  value: string;
  formula: string | null;
  valueKind: XlsxCellValueKind;
}

export type DocumentStructureElement =
  | DocxParagraphElement
  | XlsxCellElement;

export interface DocumentStructureSummary {
  partsRead: number;
  paragraphs: number;
  runs: number;
  sheets: number;
  cells: number;
  formulas: number;
  totalElements: number;
  shownElements: number;
}

export interface DocumentStructureReport {
  fileName: string;
  format: DocumentFormat;
  sourceSha256: string;
  structureSha256: string;
  truncated: boolean;
  summary: DocumentStructureSummary;
  elements: DocumentStructureElement[];
}

export interface AnalyzeOoxmlInput extends InspectOoxmlInput {
  maxElements?: number;
  maxXmlPartBytes?: number;
  maxRunsPerParagraph?: number;
}

type XmlToken =
  | {
      type: "start";
      name: string;
      localName: string;
      attributes: Readonly<Record<string, string>>;
      selfClosing: boolean;
    }
  | { type: "end"; name: string; localName: string }
  | { type: "text"; value: string };

interface MutableDocxRun {
  runIndex: number;
  text: string[];
  bold: boolean;
  italic: boolean;
}

interface MutableDocxParagraph {
  index: number;
  runs: DocxRunElement[];
  runCount: number;
  runsTruncated: boolean;
  tableLocation: DocxTableLocation | null;
}

interface TableCursor {
  tableIndex: number;
  rowIndex: number;
  columnIndex: number;
}

interface WorkbookSheet {
  name: string;
  relationshipId: string;
  path: string;
}

interface MutableCell {
  address: string;
  type: string;
  value: string[];
  formula: string[];
  inlineText: string[];
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new DocumentIntakeError(
      "invalid_structure_limit",
      400,
      `Параметр «${name}» должен быть целым числом от ${minimum} до ${maximum}.`
    );
  }
  return result;
}

function structureLimits(input: AnalyzeOoxmlInput): DocumentStructureLimits {
  return {
    maxElements: boundedInteger(
      input.maxElements,
      DEFAULT_STRUCTURE_LIMITS.maxElements,
      1,
      2_000,
      "maxElements"
    ),
    maxXmlPartBytes: boundedInteger(
      input.maxXmlPartBytes,
      DEFAULT_STRUCTURE_LIMITS.maxXmlPartBytes,
      1_024,
      DEFAULT_INTAKE_LIMITS.maxEntryUncompressedBytes,
      "maxXmlPartBytes"
    ),
    maxRunsPerParagraph: boundedInteger(
      input.maxRunsPerParagraph,
      DEFAULT_STRUCTURE_LIMITS.maxRunsPerParagraph,
      1,
      5_000,
      "maxRunsPerParagraph"
    )
  };
}

function localName(name: string): string {
  const separator = name.lastIndexOf(":");
  return separator < 0 ? name : name.slice(separator + 1);
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/giu,
    (source, entity: string) => {
      if (entity === "amp") return "&";
      if (entity === "lt") return "<";
      if (entity === "gt") return ">";
      if (entity === "quot") return '"';
      if (entity === "apos") return "'";
      const radix = entity.toLowerCase().startsWith("#x") ? 16 : 10;
      const digits = entity.slice(radix === 16 ? 2 : 1);
      const codePoint = Number.parseInt(digits, radix);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        throw new DocumentIntakeError(
          "invalid_xml_entity",
          422,
          "В документе обнаружена недопустимая XML-сущность."
        );
      }
      return String.fromCodePoint(codePoint);
    }
  );
}

function assertSafeXml(xml: string, partName: string): void {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new DocumentIntakeError(
      "unsafe_xml_declaration",
      422,
      `Часть «${partName}» содержит запрещённое объявление XML. Файл отклонён.`
    );
  }
}

function findTagEnd(xml: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index] ?? "";
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function parseAttributes(source: string): {
  name: string;
  attributes: Readonly<Record<string, string>>;
} {
  let index = 0;
  while (index < source.length && /\s/u.test(source[index] ?? "")) index += 1;
  const nameStart = index;
  while (index < source.length && !/\s/u.test(source[index] ?? "")) index += 1;
  const name = source.slice(nameStart, index);
  if (name.length === 0) {
    throw new DocumentIntakeError(
      "invalid_xml_part",
      422,
      "В документе обнаружен повреждённый XML-тег."
    );
  }

  const attributes: Record<string, string> = {};
  while (index < source.length) {
    while (index < source.length && /\s/u.test(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    const attributeStart = index;
    while (
      index < source.length &&
      !/[\s=]/u.test(source[index] ?? "")
    ) {
      index += 1;
    }
    const attributeName = source.slice(attributeStart, index);
    while (index < source.length && /\s/u.test(source[index] ?? "")) index += 1;
    if ((source[index] ?? "") !== "=") {
      throw new DocumentIntakeError(
        "invalid_xml_part",
        422,
        `У атрибута «${attributeName}» отсутствует значение.`
      );
    }
    index += 1;
    while (index < source.length && /\s/u.test(source[index] ?? "")) index += 1;
    const quote = source[index] ?? "";
    if (quote !== '"' && quote !== "'") {
      throw new DocumentIntakeError(
        "invalid_xml_part",
        422,
        `Значение атрибута «${attributeName}» должно быть заключено в кавычки.`
      );
    }
    index += 1;
    const valueStart = index;
    while (index < source.length && (source[index] ?? "") !== quote) index += 1;
    if (index >= source.length) {
      throw new DocumentIntakeError(
        "invalid_xml_part",
        422,
        `Значение атрибута «${attributeName}» не завершено.`
      );
    }
    attributes[attributeName] = decodeXmlEntities(source.slice(valueStart, index));
    index += 1;
  }
  return { name, attributes };
}

function tokenizeXml(
  xml: string,
  partName: string,
  receive: (token: XmlToken) => void
): void {
  assertSafeXml(xml, partName);
  let index = 0;
  while (index < xml.length) {
    const opening = xml.indexOf("<", index);
    if (opening < 0) {
      if (index < xml.length) {
        receive({ type: "text", value: decodeXmlEntities(xml.slice(index)) });
      }
      break;
    }
    if (opening > index) {
      receive({ type: "text", value: decodeXmlEntities(xml.slice(index, opening)) });
    }
    if (xml.startsWith("<!--", opening)) {
      const closing = xml.indexOf("-->", opening + 4);
      if (closing < 0) throwInvalidXml(partName);
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<?", opening)) {
      const closing = xml.indexOf("?>", opening + 2);
      if (closing < 0) throwInvalidXml(partName);
      index = closing + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", opening)) {
      const closing = xml.indexOf("]]>", opening + 9);
      if (closing < 0) throwInvalidXml(partName);
      receive({ type: "text", value: xml.slice(opening + 9, closing) });
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<!", opening)) {
      throw new DocumentIntakeError(
        "unsafe_xml_declaration",
        422,
        `Часть «${partName}» содержит неподдерживаемое объявление XML.`
      );
    }

    const closing = findTagEnd(xml, opening + 1);
    if (closing < 0) throwInvalidXml(partName);
    const raw = xml.slice(opening + 1, closing).trim();
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      receive({ type: "end", name, localName: localName(name) });
    } else {
      const selfClosing = raw.endsWith("/");
      const source = selfClosing ? raw.slice(0, -1).trimEnd() : raw;
      const parsed = parseAttributes(source);
      receive({
        type: "start",
        name: parsed.name,
        localName: localName(parsed.name),
        attributes: parsed.attributes,
        selfClosing
      });
      if (selfClosing) {
        receive({ type: "end", name: parsed.name, localName: localName(parsed.name) });
      }
    }
    index = closing + 1;
  }
}

function throwInvalidXml(partName: string): never {
  throw new DocumentIntakeError(
    "invalid_xml_part",
    422,
    `Часть «${partName}» содержит повреждённый XML.`
  );
}

function attribute(
  attributes: Readonly<Record<string, string>>,
  exactName: string,
  fallbackLocalName?: string
): string | undefined {
  const exact = attributes[exactName];
  if (exact !== undefined) return exact;
  if (fallbackLocalName === undefined) return undefined;
  return Object.entries(attributes).find(
    ([name]) => localName(name) === fallbackLocalName
  )?.[1];
}

function decodeXmlBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1] ?? 0;
      swapped[index - 1] = buffer[index] ?? 0;
    }
    return swapped.toString("utf16le");
  }
  const start =
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
      ? 3
      : 0;
  return buffer.subarray(start).toString("utf8");
}

async function readEntry(
  zipFile: ZipFile,
  entry: Entry,
  maximum: number
): Promise<string> {
  if (entry.uncompressedSize > maximum) {
    throw new DocumentIntakeError(
      "structure_part_too_large",
      413,
      `Часть «${entry.fileName}» слишком велика для структурного анализа.`
    );
  }
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk as Uint8Array);
    total += chunk.length;
    if (!Number.isSafeInteger(total) || total > maximum) {
      stream.destroy();
      throw new DocumentIntakeError(
        "structure_part_too_large",
        413,
        `Часть «${entry.fileName}» слишком велика для структурного анализа.`
      );
    }
    chunks.push(chunk);
  }
  return decodeXmlBuffer(Buffer.concat(chunks));
}

async function collectXmlParts(
  buffer: Buffer,
  include: (name: string) => boolean,
  maximum: number
): Promise<Map<string, string>> {
  let zipFile: ZipFile;
  try {
    zipFile = await yauzl.fromBufferPromise(buffer, {
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true
    });
  } catch {
    throw new DocumentIntakeError(
      "invalid_zip_package",
      422,
      "Не удалось повторно открыть пакет DOCX/XLSX для структурного анализа."
    );
  }
  const result = new Map<string, string>();
  try {
    for await (const entry of zipFile.eachEntry()) {
      if (!entry.fileName.endsWith("/") && include(entry.fileName)) {
        result.set(entry.fileName, await readEntry(zipFile, entry, maximum));
      }
    }
  } catch (error) {
    if (error instanceof DocumentIntakeError) throw error;
    throw new DocumentIntakeError(
      "invalid_structure_part",
      422,
      "Не удалось прочитать одну из структурных частей документа."
    );
  } finally {
    zipFile.close();
  }
  return result;
}

function stableElementId(prefix: string, sourceSha256: string, coordinate: string): string {
  const digest = createHash("sha256")
    .update(sourceSha256)
    .update("\u0000")
    .update(coordinate)
    .digest("hex")
    .slice(0, 24);
  return `${prefix}-${digest}`;
}

function enabledProperty(
  attributes: Readonly<Record<string, string>>
): boolean {
  const value = attribute(attributes, "w:val", "val")?.toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

function docxPartNames(names: readonly string[]): string[] {
  return names
    .filter(
      (name) =>
        name === "word/document.xml" ||
        /^word\/(header|footer)[0-9]+\.xml$/u.test(name) ||
        name === "word/footnotes.xml" ||
        name === "word/endnotes.xml"
    )
    .sort((left, right) => {
      if (left === "word/document.xml") return -1;
      if (right === "word/document.xml") return 1;
      return left.localeCompare(right);
    });
}

function parseDocxPart(
  xml: string,
  partName: string,
  sourceSha256: string,
  limits: DocumentStructureLimits,
  elements: DocxParagraphElement[],
  counters: { paragraphs: number; runs: number }
): void {
  let paragraphIndex = -1;
  let currentParagraph: MutableDocxParagraph | null = null;
  let currentRun: MutableDocxRun | null = null;
  let textDepth = 0;
  let tableSequence = -1;
  const tableStack: TableCursor[] = [];

  const closeRun = (): void => {
    if (currentParagraph === null || currentRun === null) return;
    const text = currentRun.text.join("");
    counters.runs += 1;
    currentParagraph.runCount += 1;
    if (currentParagraph.runs.length < limits.maxRunsPerParagraph) {
      currentParagraph.runs.push({
        id: stableElementId(
          "run",
          sourceSha256,
          `${partName}:paragraph:${currentParagraph.index}:run:${currentRun.runIndex}`
        ),
        kind: "run",
        part: partName,
        paragraphIndex: currentParagraph.index,
        runIndex: currentRun.runIndex,
        text,
        bold: currentRun.bold,
        italic: currentRun.italic
      });
    } else {
      currentParagraph.runsTruncated = true;
    }
    currentRun = null;
    textDepth = 0;
  };

  const closeParagraph = (): void => {
    if (currentParagraph === null) return;
    closeRun();
    counters.paragraphs += 1;
    if (elements.length < limits.maxElements) {
      elements.push({
        id: stableElementId(
          "paragraph",
          sourceSha256,
          `${partName}:paragraph:${currentParagraph.index}`
        ),
        kind: "paragraph",
        part: partName,
        index: currentParagraph.index,
        text: currentParagraph.runs.map((run) => run.text).join(""),
        runs: currentParagraph.runs,
        runsTruncated: currentParagraph.runsTruncated,
        tableLocation: currentParagraph.tableLocation
      });
    }
    currentParagraph = null;
  };

  tokenizeXml(xml, partName, (token) => {
    if (token.type === "text") {
      if (textDepth > 0 && currentRun !== null) currentRun.text.push(token.value);
      return;
    }

    if (token.type === "start") {
      if (token.localName === "tbl") {
        tableSequence += 1;
        tableStack.push({ tableIndex: tableSequence, rowIndex: -1, columnIndex: -1 });
      } else if (token.localName === "tr") {
        const cursor = tableStack.at(-1);
        if (cursor !== undefined) {
          cursor.rowIndex += 1;
          cursor.columnIndex = -1;
        }
      } else if (token.localName === "tc") {
        const cursor = tableStack.at(-1);
        if (cursor !== undefined) cursor.columnIndex += 1;
      } else if (token.localName === "p") {
        closeParagraph();
        paragraphIndex += 1;
        const cursor = tableStack.at(-1);
        currentParagraph = {
          index: paragraphIndex,
          runs: [],
          runCount: 0,
          runsTruncated: false,
          tableLocation:
            cursor === undefined
              ? null
              : {
                  tableIndex: cursor.tableIndex,
                  rowIndex: cursor.rowIndex,
                  columnIndex: cursor.columnIndex
                }
        };
      } else if (token.localName === "r" && currentParagraph !== null) {
        closeRun();
        currentRun = {
          runIndex: currentParagraph.runCount,
          text: [],
          bold: false,
          italic: false
        };
      } else if (token.localName === "b" && currentRun !== null) {
        currentRun.bold = enabledProperty(token.attributes);
      } else if (token.localName === "i" && currentRun !== null) {
        currentRun.italic = enabledProperty(token.attributes);
      } else if (token.localName === "t" && currentRun !== null) {
        textDepth += 1;
      } else if (token.localName === "tab" && currentRun !== null) {
        currentRun.text.push("\t");
      } else if (
        (token.localName === "br" || token.localName === "cr") &&
        currentRun !== null
      ) {
        currentRun.text.push("\n");
      }
      return;
    }

    if (token.localName === "t" && textDepth > 0) {
      textDepth -= 1;
    } else if (token.localName === "r") {
      closeRun();
    } else if (token.localName === "p") {
      closeParagraph();
    } else if (token.localName === "tbl") {
      tableStack.pop();
    }
  });
  closeParagraph();
}

function parseRelationships(xml: string, partName: string): Map<string, string> {
  const result = new Map<string, string>();
  tokenizeXml(xml, partName, (token) => {
    if (token.type !== "start" || token.localName !== "Relationship") return;
    const mode = attribute(token.attributes, "TargetMode")?.toLowerCase();
    if (mode === "external") return;
    const id = attribute(token.attributes, "Id");
    const target = attribute(token.attributes, "Target");
    if (id !== undefined && target !== undefined) result.set(id, target);
  });
  return result;
}

function resolveRelationshipTarget(basePart: string, target: string): string {
  const normalizedTarget = target.replace(/^\/+/, "");
  const resolved = path.posix.normalize(
    target.startsWith("/")
      ? normalizedTarget
      : path.posix.join(path.posix.dirname(basePart), normalizedTarget)
  );
  if (resolved === ".." || resolved.startsWith("../") || !resolved.startsWith("xl/")) {
    throw new DocumentIntakeError(
      "unsafe_relationship_target",
      422,
      "В книге обнаружена небезопасная внутренняя ссылка на часть пакета."
    );
  }
  return resolved;
}

function parseWorkbookSheets(
  xml: string,
  relationships: ReadonlyMap<string, string>
): WorkbookSheet[] {
  const sheets: WorkbookSheet[] = [];
  tokenizeXml(xml, "xl/workbook.xml", (token) => {
    if (token.type !== "start" || token.localName !== "sheet") return;
    const name = attribute(token.attributes, "name");
    const relationshipId =
      attribute(token.attributes, "r:id") ??
      Object.entries(token.attributes).find(
        ([key]) => key.endsWith(":id")
      )?.[1];
    if (name === undefined || relationshipId === undefined) {
      throw new DocumentIntakeError(
        "invalid_workbook_sheet",
        422,
        "В книге обнаружено неполное описание листа."
      );
    }
    const target = relationships.get(relationshipId);
    if (target === undefined) {
      throw new DocumentIntakeError(
        "worksheet_relationship_missing",
        422,
        `Не удалось найти внутреннюю часть листа «${name}».`
      );
    }
    sheets.push({
      name,
      relationshipId,
      path: resolveRelationshipTarget("xl/workbook.xml", target)
    });
  });
  return sheets;
}

function parseSharedStrings(xml: string): string[] {
  const values: string[] = [];
  let insideItem = false;
  let textDepth = 0;
  let current: string[] = [];
  tokenizeXml(xml, "xl/sharedStrings.xml", (token) => {
    if (token.type === "text") {
      if (insideItem && textDepth > 0) current.push(token.value);
      return;
    }
    if (token.type === "start") {
      if (token.localName === "si") {
        insideItem = true;
        current = [];
      } else if (insideItem && token.localName === "t") {
        textDepth += 1;
      }
      return;
    }
    if (insideItem && token.localName === "t" && textDepth > 0) {
      textDepth -= 1;
    } else if (token.localName === "si") {
      values.push(current.join(""));
      insideItem = false;
      current = [];
      textDepth = 0;
    }
  });
  return values;
}

function cellValue(
  cell: MutableCell,
  sharedStrings: readonly string[]
): { value: string; valueKind: XlsxCellValueKind } {
  const raw = cell.value.join("");
  if (cell.formula.length > 0) return { value: raw, valueKind: "formula" };
  if (cell.type === "s") {
    const index = Number.parseInt(raw, 10);
    return {
      value: Number.isInteger(index) && index >= 0 ? (sharedStrings[index] ?? "") : "",
      valueKind: "text"
    };
  }
  if (cell.type === "inlineStr") {
    return { value: cell.inlineText.join(""), valueKind: "text" };
  }
  if (cell.type === "str") return { value: raw, valueKind: "text" };
  if (cell.type === "b") {
    return { value: raw === "1" ? "Да" : "Нет", valueKind: "boolean" };
  }
  if (cell.type === "e") return { value: raw, valueKind: "error" };
  if (raw.length === 0) return { value: "", valueKind: "blank" };
  return { value: raw, valueKind: "number" };
}

function parseWorksheet(
  xml: string,
  sheet: WorkbookSheet,
  sharedStrings: readonly string[],
  sourceSha256: string,
  limits: DocumentStructureLimits,
  elements: XlsxCellElement[],
  counters: { cells: number; formulas: number }
): void {
  let currentCell: MutableCell | null = null;
  let capture: "value" | "formula" | "inline" | null = null;

  const closeCell = (): void => {
    if (currentCell === null) return;
    const calculated = cellValue(currentCell, sharedStrings);
    const formula = currentCell.formula.join("");
    counters.cells += 1;
    if (formula.length > 0) counters.formulas += 1;
    if (elements.length < limits.maxElements) {
      elements.push({
        id: stableElementId(
          "cell",
          sourceSha256,
          `${sheet.path}:cell:${currentCell.address}`
        ),
        kind: "cell",
        sheetName: sheet.name,
        sheetPath: sheet.path,
        address: currentCell.address,
        value: calculated.value,
        formula: formula.length === 0 ? null : formula,
        valueKind: calculated.valueKind
      });
    }
    currentCell = null;
    capture = null;
  };

  tokenizeXml(xml, sheet.path, (token) => {
    if (token.type === "text") {
      if (currentCell === null || capture === null) return;
      if (capture === "value") currentCell.value.push(token.value);
      else if (capture === "formula") currentCell.formula.push(token.value);
      else currentCell.inlineText.push(token.value);
      return;
    }
    if (token.type === "start") {
      if (token.localName === "c") {
        closeCell();
        const address = attribute(token.attributes, "r")?.toUpperCase();
        if (address === undefined || !/^[A-Z]{1,4}[1-9][0-9]{0,6}$/u.test(address)) {
          throw new DocumentIntakeError(
            "invalid_cell_address",
            422,
            `На листе «${sheet.name}» обнаружена ячейка без допустимого адреса.`
          );
        }
        currentCell = {
          address,
          type: attribute(token.attributes, "t") ?? "n",
          value: [],
          formula: [],
          inlineText: []
        };
      } else if (currentCell !== null && token.localName === "v") {
        capture = "value";
      } else if (currentCell !== null && token.localName === "f") {
        capture = "formula";
      } else if (
        currentCell !== null &&
        currentCell.type === "inlineStr" &&
        token.localName === "t"
      ) {
        capture = "inline";
      }
      return;
    }
    if (
      token.localName === "v" ||
      token.localName === "f" ||
      token.localName === "t"
    ) {
      capture = null;
    } else if (token.localName === "c") {
      closeCell();
    }
  });
  closeCell();
}

function structureDigest(
  format: DocumentFormat,
  sourceSha256: string,
  elements: readonly DocumentStructureElement[]
): string {
  return createHash("sha256")
    .update(JSON.stringify({ format, sourceSha256, elements }))
    .digest("hex");
}

export async function analyzeOoxmlBuffer(
  input: AnalyzeOoxmlInput
): Promise<DocumentStructureReport> {
  const limits = structureLimits(input);
  const intake = await inspectOoxmlBuffer(input);
  if (intake.decision === "rejected") {
    throw new DocumentIntakeError(
      "document_rejected",
      422,
      "Структурный анализ недоступен: сначала устраните блокирующие замечания проверки."
    );
  }

  if (intake.format === "docx") {
    const names = docxPartNames(intake.parts.map((part) => part.name));
    const parts = await collectXmlParts(
      input.buffer,
      (name) => names.includes(name),
      limits.maxXmlPartBytes
    );
    const elements: DocxParagraphElement[] = [];
    const counters = { paragraphs: 0, runs: 0 };
    for (const name of names) {
      const xml = parts.get(name);
      if (xml !== undefined) {
        parseDocxPart(xml, name, intake.sha256, limits, elements, counters);
      }
    }
    const summary: DocumentStructureSummary = {
      partsRead: parts.size,
      paragraphs: counters.paragraphs,
      runs: counters.runs,
      sheets: 0,
      cells: 0,
      formulas: 0,
      totalElements: counters.paragraphs,
      shownElements: elements.length
    };
    return {
      fileName: intake.fileName,
      format: intake.format,
      sourceSha256: intake.sha256,
      structureSha256: structureDigest(intake.format, intake.sha256, elements),
      truncated: counters.paragraphs > elements.length,
      summary,
      elements
    };
  }

  const parts = await collectXmlParts(
    input.buffer,
    (name) =>
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      name === "xl/sharedStrings.xml" ||
      /^xl\/worksheets\/[^/]+\.xml$/u.test(name),
    limits.maxXmlPartBytes
  );
  const workbook = parts.get("xl/workbook.xml");
  if (workbook === undefined) {
    throw new DocumentIntakeError(
      "workbook_part_missing",
      422,
      "Не найдена основная часть книги XLSX."
    );
  }
  const relationshipXml = parts.get("xl/_rels/workbook.xml.rels") ?? "<Relationships/>";
  const relationships = parseRelationships(
    relationshipXml,
    "xl/_rels/workbook.xml.rels"
  );
  const sheets = parseWorkbookSheets(workbook, relationships);
  const sharedStringsXml = parts.get("xl/sharedStrings.xml");
  const sharedStrings =
    sharedStringsXml === undefined ? [] : parseSharedStrings(sharedStringsXml);
  const elements: XlsxCellElement[] = [];
  const counters = { cells: 0, formulas: 0 };
  for (const sheet of sheets) {
    const xml = parts.get(sheet.path);
    if (xml === undefined) {
      throw new DocumentIntakeError(
        "worksheet_part_missing",
        422,
        `Не найдена внутренняя часть листа «${sheet.name}».`
      );
    }
    parseWorksheet(
      xml,
      sheet,
      sharedStrings,
      intake.sha256,
      limits,
      elements,
      counters
    );
  }
  const summary: DocumentStructureSummary = {
    partsRead: parts.size,
    paragraphs: 0,
    runs: 0,
    sheets: sheets.length,
    cells: counters.cells,
    formulas: counters.formulas,
    totalElements: counters.cells,
    shownElements: elements.length
  };
  return {
    fileName: intake.fileName,
    format: intake.format,
    sourceSha256: intake.sha256,
    structureSha256: structureDigest(intake.format, intake.sha256, elements),
    truncated: counters.cells > elements.length,
    summary,
    elements
  };
}
