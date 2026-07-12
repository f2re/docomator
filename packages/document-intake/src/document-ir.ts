import { createHash } from "node:crypto";
import path from "node:path";

import yauzl, { type Entry, type ZipFile } from "yauzl";

import {
  DEFAULT_INTAKE_LIMITS,
  DocumentIntakeError,
  inspectOoxmlBuffer,
  type DocumentFormat,
  type DocumentIntakeReport,
  type InspectOoxmlInput
} from "./intake.js";

export interface AnalyzeOoxmlInput extends InspectOoxmlInput {
  maxElements?: number;
  maxStructurePartBytes?: number;
}

export interface DocumentStructureTotals {
  structuralParts: number;
  paragraphs: number;
  runs: number;
  sheets: number;
  cells: number;
  returnedElements: number;
}

export interface DocxTableLocation {
  tableIndex: number;
  rowIndex: number;
  columnIndex: number;
}

export interface DocxRunElement {
  id: string;
  index: number;
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface DocxParagraphElement {
  id: string;
  kind: "paragraph";
  partName: string;
  index: number;
  text: string;
  runs: DocxRunElement[];
  tableLocation?: DocxTableLocation;
}

export type DocxPartKind =
  | "document"
  | "header"
  | "footer"
  | "footnotes"
  | "endnotes";

export interface DocxPartStructure {
  name: string;
  kind: DocxPartKind;
  paragraphCount: number;
  paragraphs: DocxParagraphElement[];
}

export interface DocxDocumentStructure {
  parts: DocxPartStructure[];
}

export type XlsxCellValueKind =
  | "text"
  | "number"
  | "boolean"
  | "formula"
  | "error"
  | "empty";

export interface XlsxCellElement {
  id: string;
  kind: "cell";
  partName: string;
  sheetName: string;
  sheetIndex: number;
  address: string;
  value: string;
  valueKind: XlsxCellValueKind;
  formula?: string;
}

export interface XlsxSheetStructure {
  id: string;
  name: string;
  index: number;
  partName: string;
  cellCount: number;
  cells: XlsxCellElement[];
}

export interface XlsxDocumentStructure {
  sheets: XlsxSheetStructure[];
}

export interface DocumentStructure {
  version: 1;
  fileName: string;
  format: DocumentFormat;
  sourceSha256: string;
  truncated: boolean;
  totals: DocumentStructureTotals;
  docx?: DocxDocumentStructure;
  xlsx?: XlsxDocumentStructure;
}

export interface DocumentAnalysisResult {
  intake: DocumentIntakeReport;
  structure: DocumentStructure;
}

interface XmlHandlers {
  start?: (localName: string, attributes: Readonly<Record<string, string>>) => void;
  end?: (localName: string) => void;
  text?: (value: string) => void;
}

interface StructureBudget {
  readonly limit: number;
  returned: number;
}

interface DocxPartParseResult {
  part: DocxPartStructure;
  paragraphCount: number;
  runCount: number;
}

interface WorkbookSheetReference {
  name: string;
  relationId: string;
  index: number;
}

interface WorksheetRelationship {
  id: string;
  target: string;
}

interface XlsxSheetParseResult {
  sheet: XlsxSheetStructure;
  cellCount: number;
}

interface MutableRun {
  index: number;
  text: string;
  bold: boolean;
  italic: boolean;
}

interface MutableParagraph {
  index: number;
  runs: DocxRunElement[];
  tableLocation?: DocxTableLocation;
}

interface MutableCell {
  address: string;
  type: string;
  formula: string;
  rawValue: string;
  inlineText: string;
}

const DEFAULT_MAX_ELEMENTS = 500;
const MAX_ALLOWED_ELEMENTS = 2_000;
const DEFAULT_MAX_STRUCTURE_PART_BYTES = 8 * 1024 * 1024;

function positiveBoundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  fieldName: string
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new DocumentIntakeError(
      "invalid_structure_limit",
      400,
      `Параметр «${fieldName}» должен быть целым числом от 1 до ${maximum}.`
    );
  }
  return normalized;
}

function stableId(prefix: string, ...coordinates: readonly (string | number)[]): string {
  const digest = createHash("sha256")
    .update(coordinates.map(String).join("\u0000"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}-${digest}`;
}

function localName(qualifiedName: string): string {
  const separator = qualifiedName.lastIndexOf(":");
  return (separator === -1 ? qualifiedName : qualifiedName.slice(separator + 1)).toLowerCase();
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu,
    (_match, entity: string) => {
      const normalized = entity.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return "�";
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return "�";
      }
    }
  );
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (name === undefined) continue;
    attributes[name] = decodeXmlEntities(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function attribute(
  attributes: Readonly<Record<string, string>>,
  exactName: string,
  localFallback?: string
): string | undefined {
  const exact = attributes[exactName];
  if (exact !== undefined) return exact;
  if (localFallback === undefined) return undefined;
  for (const [name, value] of Object.entries(attributes)) {
    if (localName(name) === localFallback.toLowerCase()) return value;
  }
  return undefined;
}

function assertSafeXml(xml: string, partName: string): void {
  if (/<!DOCTYPE\b|<!ENTITY\b/iu.test(xml)) {
    throw new DocumentIntakeError(
      "unsafe_xml_declaration",
      422,
      `Часть «${partName}» содержит запрещённое объявление XML. Файл отклонён.`
    );
  }
}

function scanXml(xml: string, partName: string, handlers: XmlHandlers): void {
  assertSafeXml(xml, partName);
  const tokens = xml.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<[^>]+>|[^<]+/gu) ?? [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<?")) continue;
    if (token.startsWith("<![CDATA[")) {
      handlers.text?.(token.slice(9, -3));
      continue;
    }
    if (!token.startsWith("<")) {
      handlers.text?.(decodeXmlEntities(token));
      continue;
    }
    if (token.startsWith("</")) {
      const rawName = token.slice(2, -1).trim().split(/\s/u)[0] ?? "";
      if (rawName.length > 0) handlers.end?.(localName(rawName));
      continue;
    }
    if (token.startsWith("<!")) continue;
    const selfClosing = /\/\s*>$/u.test(token);
    const inner = token.slice(1, selfClosing ? -2 : -1).trim();
    const rawName = inner.split(/\s/u)[0] ?? "";
    if (rawName.length === 0) continue;
    const attributes = parseAttributes(inner.slice(rawName.length));
    const normalizedName = localName(rawName);
    handlers.start?.(normalizedName, attributes);
    if (selfClosing) handlers.end?.(normalizedName);
  }
}

async function collectEntries(buffer: Buffer): Promise<{ zipFile: ZipFile; entries: Map<string, Entry> }> {
  const zipFile = await yauzl.fromBufferPromise(buffer, {
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true
  });
  const entries = new Map<string, Entry>();
  try {
    for await (const entry of zipFile.eachEntry()) {
      if (!entry.fileName.endsWith("/")) entries.set(entry.fileName, entry);
    }
    return { zipFile, entries };
  } catch (error) {
    zipFile.close();
    throw error;
  }
}

async function readEntryText(
  zipFile: ZipFile,
  entry: Entry,
  maximumBytes: number
): Promise<string> {
  if (entry.uncompressedSize > maximumBytes) {
    throw new DocumentIntakeError(
      "structure_part_too_large",
      413,
      `Структурная часть «${entry.fileName}» слишком велика для безопасного анализа.`
    );
  }
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
    total += chunk.length;
    if (!Number.isSafeInteger(total) || total > maximumBytes) {
      stream.destroy();
      throw new DocumentIntakeError(
        "structure_part_too_large",
        413,
        `Структурная часть «${entry.fileName}» слишком велика для безопасного анализа.`
      );
    }
    chunks.push(chunk);
  }
  if (total !== entry.uncompressedSize) {
    throw new DocumentIntakeError(
      "structure_part_size_mismatch",
      422,
      `Размер части «${entry.fileName}» не совпадает с описанием пакета.`
    );
  }
  const content = Buffer.concat(chunks);
  if (content.length >= 2 && content[0] === 0xff && content[1] === 0xfe) {
    return content.subarray(2).toString("utf16le");
  }
  if (content.length >= 2 && content[0] === 0xfe && content[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(content.length - 2);
    for (let index = 2; index + 1 < content.length; index += 2) {
      swapped[index - 2] = content[index + 1] ?? 0;
      swapped[index - 1] = content[index] ?? 0;
    }
    return swapped.toString("utf16le");
  }
  return content.toString("utf8");
}

function docxPartKind(name: string): DocxPartKind | null {
  if (name === "word/document.xml") return "document";
  if (/^word\/header\d+\.xml$/u.test(name)) return "header";
  if (/^word\/footer\d+\.xml$/u.test(name)) return "footer";
  if (name === "word/footnotes.xml") return "footnotes";
  if (name === "word/endnotes.xml") return "endnotes";
  return null;
}

function booleanStyle(attributes: Readonly<Record<string, string>>): boolean {
  const value = attribute(attributes, "w:val", "val")?.toLowerCase();
  return value !== "0" && value !== "false" && value !== "off" && value !== "none";
}

function parseDocxPart(
  xml: string,
  partName: string,
  kind: DocxPartKind,
  sourceSha256: string,
  budget: StructureBudget
): DocxPartParseResult {
  const paragraphs: DocxParagraphElement[] = [];
  const tableStack: Array<{ tableIndex: number; rowIndex: number; columnIndex: number }> = [];
  let tableCounter = 0;
  let paragraphCounter = 0;
  let totalParagraphs = 0;
  let totalRuns = 0;
  let currentParagraph: MutableParagraph | null = null;
  let currentRun: MutableRun | null = null;
  let runCounter = 0;
  let textDepth = 0;

  const appendRunText = (value: string): void => {
    if (currentRun !== null) currentRun.text += value;
  };

  scanXml(xml, partName, {
    start(name, attributes) {
      if (name === "tbl") {
        tableStack.push({ tableIndex: tableCounter, rowIndex: -1, columnIndex: -1 });
        tableCounter += 1;
      } else if (name === "tr") {
        const table = tableStack.at(-1);
        if (table !== undefined) {
          table.rowIndex += 1;
          table.columnIndex = -1;
        }
      } else if (name === "tc") {
        const table = tableStack.at(-1);
        if (table !== undefined) table.columnIndex += 1;
      } else if (name === "p") {
        const table = tableStack.at(-1);
        currentParagraph = {
          index: paragraphCounter,
          runs: [],
          ...(table === undefined
            ? {}
            : {
                tableLocation: {
                  tableIndex: table.tableIndex,
                  rowIndex: Math.max(0, table.rowIndex),
                  columnIndex: Math.max(0, table.columnIndex)
                }
              })
        };
        paragraphCounter += 1;
        runCounter = 0;
      } else if (name === "r" && currentParagraph !== null) {
        currentRun = { index: runCounter, text: "", bold: false, italic: false };
        runCounter += 1;
      } else if (name === "b" && currentRun !== null) {
        currentRun.bold = booleanStyle(attributes);
      } else if (name === "i" && currentRun !== null) {
        currentRun.italic = booleanStyle(attributes);
      } else if (name === "t" || name === "deltext") {
        textDepth += 1;
      } else if (name === "tab") {
        appendRunText("\t");
      } else if (name === "br" || name === "cr") {
        appendRunText("\n");
      }
    },
    text(value) {
      if (textDepth > 0) appendRunText(value);
    },
    end(name) {
      if (name === "t" || name === "deltext") {
        textDepth = Math.max(0, textDepth - 1);
      } else if (name === "r") {
        if (currentParagraph !== null && currentRun !== null) {
          currentParagraph.runs.push({
            id: stableId(
              "run",
              sourceSha256,
              partName,
              currentParagraph.index,
              currentRun.index
            ),
            index: currentRun.index,
            text: currentRun.text,
            bold: currentRun.bold,
            italic: currentRun.italic
          });
          totalRuns += 1;
        }
        currentRun = null;
      } else if (name === "p") {
        if (currentParagraph !== null) {
          totalParagraphs += 1;
          if (budget.returned < budget.limit) {
            paragraphs.push({
              id: stableId("paragraph", sourceSha256, partName, currentParagraph.index),
              kind: "paragraph",
              partName,
              index: currentParagraph.index,
              text: currentParagraph.runs.map((run) => run.text).join(""),
              runs: currentParagraph.runs,
              ...(currentParagraph.tableLocation === undefined
                ? {}
                : { tableLocation: currentParagraph.tableLocation })
            });
            budget.returned += 1;
          }
        }
        currentParagraph = null;
        currentRun = null;
      } else if (name === "tbl") {
        tableStack.pop();
      }
    }
  });

  return {
    part: { name: partName, kind, paragraphCount: totalParagraphs, paragraphs },
    paragraphCount: totalParagraphs,
    runCount: totalRuns
  };
}

async function buildDocxStructure(
  zipFile: ZipFile,
  entries: ReadonlyMap<string, Entry>,
  sourceSha256: string,
  budget: StructureBudget,
  maximumPartBytes: number
): Promise<{ docx: DocxDocumentStructure; paragraphs: number; runs: number }> {
  const partNames = [...entries.keys()]
    .filter((name) => docxPartKind(name) !== null)
    .sort((left, right) => {
      if (left === "word/document.xml") return -1;
      if (right === "word/document.xml") return 1;
      return left.localeCompare(right);
    });
  const parts: DocxPartStructure[] = [];
  let paragraphs = 0;
  let runs = 0;
  for (const partName of partNames) {
    const entry = entries.get(partName);
    const kind = docxPartKind(partName);
    if (entry === undefined || kind === null) continue;
    const xml = await readEntryText(zipFile, entry, maximumPartBytes);
    const parsed = parseDocxPart(xml, partName, kind, sourceSha256, budget);
    parts.push(parsed.part);
    paragraphs += parsed.paragraphCount;
    runs += parsed.runCount;
  }
  return { docx: { parts }, paragraphs, runs };
}

function parseWorkbookSheets(xml: string, partName: string): WorkbookSheetReference[] {
  const sheets: WorkbookSheetReference[] = [];
  scanXml(xml, partName, {
    start(name, attributes) {
      if (name !== "sheet") return;
      const sheetName = attribute(attributes, "name");
      const relationId = attribute(attributes, "r:id") ?? attribute(attributes, "id");
      if (sheetName !== undefined && relationId !== undefined) {
        sheets.push({ name: sheetName, relationId, index: sheets.length });
      }
    }
  });
  return sheets;
}

function parseWorkbookRelationships(xml: string, partName: string): WorksheetRelationship[] {
  const relationships: WorksheetRelationship[] = [];
  scanXml(xml, partName, {
    start(name, attributes) {
      if (name !== "relationship") return;
      const targetMode = attribute(attributes, "TargetMode", "targetmode");
      if (targetMode?.toLowerCase() === "external") return;
      const id = attribute(attributes, "Id", "id");
      const target = attribute(attributes, "Target", "target");
      if (id !== undefined && target !== undefined) relationships.push({ id, target });
    }
  });
  return relationships;
}

function resolveRelationshipTarget(sourcePart: string, target: string): string {
  const normalized = target.startsWith("/")
    ? path.posix.normalize(target.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(sourcePart), target));
  if (normalized.length === 0 || normalized === "." || normalized.startsWith("../")) {
    throw new DocumentIntakeError(
      "unsafe_relationship_target",
      422,
      "В книге найдена небезопасная внутренняя ссылка на часть файла."
    );
  }
  return normalized;
}

function parseSharedStrings(xml: string, partName: string): string[] {
  const strings: string[] = [];
  let inItem = false;
  let textDepth = 0;
  let current = "";
  scanXml(xml, partName, {
    start(name) {
      if (name === "si") {
        inItem = true;
        current = "";
      } else if (name === "t" && inItem) {
        textDepth += 1;
      }
    },
    text(value) {
      if (inItem && textDepth > 0) current += value;
    },
    end(name) {
      if (name === "t") textDepth = Math.max(0, textDepth - 1);
      if (name === "si" && inItem) {
        strings.push(current);
        inItem = false;
      }
    }
  });
  return strings;
}

function resolveCellValue(
  cell: MutableCell,
  sharedStrings: readonly string[]
): { value: string; valueKind: XlsxCellValueKind } {
  if (cell.formula.length > 0) {
    return { value: cell.rawValue, valueKind: "formula" };
  }
  if (cell.type === "s") {
    const index = Number.parseInt(cell.rawValue, 10);
    return {
      value: Number.isInteger(index) && index >= 0 ? sharedStrings[index] ?? "" : "",
      valueKind: "text"
    };
  }
  if (cell.type === "inlineStr") return { value: cell.inlineText, valueKind: "text" };
  if (cell.type === "str") return { value: cell.rawValue, valueKind: "text" };
  if (cell.type === "b") {
    return { value: cell.rawValue === "1" ? "true" : "false", valueKind: "boolean" };
  }
  if (cell.type === "e") return { value: cell.rawValue, valueKind: "error" };
  if (cell.rawValue.length === 0 && cell.inlineText.length === 0) {
    return { value: "", valueKind: "empty" };
  }
  return { value: cell.rawValue, valueKind: "number" };
}

function parseWorksheet(
  xml: string,
  partName: string,
  sheet: WorkbookSheetReference,
  sharedStrings: readonly string[],
  sourceSha256: string,
  budget: StructureBudget
): XlsxSheetParseResult {
  const cells: XlsxCellElement[] = [];
  let currentCell: MutableCell | null = null;
  let captureFormula = 0;
  let captureValue = 0;
  let captureInlineText = 0;
  let cellCount = 0;

  scanXml(xml, partName, {
    start(name, attributes) {
      if (name === "c") {
        const address = attribute(attributes, "r") ?? `CELL_${cellCount + 1}`;
        currentCell = {
          address: address.toUpperCase(),
          type: attribute(attributes, "t") ?? "n",
          formula: "",
          rawValue: "",
          inlineText: ""
        };
      } else if (name === "f" && currentCell !== null) {
        captureFormula += 1;
      } else if (name === "v" && currentCell !== null) {
        captureValue += 1;
      } else if (name === "t" && currentCell !== null) {
        captureInlineText += 1;
      }
    },
    text(value) {
      if (currentCell === null) return;
      if (captureFormula > 0) currentCell.formula += value;
      else if (captureValue > 0) currentCell.rawValue += value;
      else if (captureInlineText > 0) currentCell.inlineText += value;
    },
    end(name) {
      if (name === "f") captureFormula = Math.max(0, captureFormula - 1);
      else if (name === "v") captureValue = Math.max(0, captureValue - 1);
      else if (name === "t") captureInlineText = Math.max(0, captureInlineText - 1);
      else if (name === "c" && currentCell !== null) {
        const resolved = resolveCellValue(currentCell, sharedStrings);
        cellCount += 1;
        if (budget.returned < budget.limit) {
          cells.push({
            id: stableId(
              "cell",
              sourceSha256,
              partName,
              sheet.index,
              currentCell.address
            ),
            kind: "cell",
            partName,
            sheetName: sheet.name,
            sheetIndex: sheet.index,
            address: currentCell.address,
            value: resolved.value,
            valueKind: resolved.valueKind,
            ...(currentCell.formula.length === 0 ? {} : { formula: currentCell.formula })
          });
          budget.returned += 1;
        }
        currentCell = null;
      }
    }
  });

  return {
    sheet: {
      id: stableId("sheet", sourceSha256, partName, sheet.index),
      name: sheet.name,
      index: sheet.index,
      partName,
      cellCount,
      cells
    },
    cellCount
  };
}

async function buildXlsxStructure(
  zipFile: ZipFile,
  entries: ReadonlyMap<string, Entry>,
  sourceSha256: string,
  budget: StructureBudget,
  maximumPartBytes: number
): Promise<{ xlsx: XlsxDocumentStructure; cells: number }> {
  const workbookEntry = entries.get("xl/workbook.xml");
  if (workbookEntry === undefined) {
    throw new DocumentIntakeError(
      "workbook_missing",
      422,
      "В книге отсутствует основная часть со списком листов."
    );
  }
  const workbookXml = await readEntryText(zipFile, workbookEntry, maximumPartBytes);
  const sheetReferences = parseWorkbookSheets(workbookXml, workbookEntry.fileName);

  const relationshipsEntry = entries.get("xl/_rels/workbook.xml.rels");
  const relationships =
    relationshipsEntry === undefined
      ? []
      : parseWorkbookRelationships(
          await readEntryText(zipFile, relationshipsEntry, maximumPartBytes),
          relationshipsEntry.fileName
        );
  const relationshipMap = new Map(relationships.map((item) => [item.id, item.target]));

  const sharedStringsEntry = entries.get("xl/sharedStrings.xml");
  const sharedStrings =
    sharedStringsEntry === undefined
      ? []
      : parseSharedStrings(
          await readEntryText(zipFile, sharedStringsEntry, maximumPartBytes),
          sharedStringsEntry.fileName
        );

  const sheets: XlsxSheetStructure[] = [];
  let cellCount = 0;
  for (const sheet of sheetReferences) {
    const target = relationshipMap.get(sheet.relationId);
    if (target === undefined) {
      throw new DocumentIntakeError(
        "worksheet_relationship_missing",
        422,
        `Для листа «${sheet.name}» не найдена внутренняя ссылка на его содержимое.`
      );
    }
    const partName = resolveRelationshipTarget("xl/workbook.xml", target);
    const entry = entries.get(partName);
    if (entry === undefined) {
      throw new DocumentIntakeError(
        "worksheet_part_missing",
        422,
        `Для листа «${sheet.name}» отсутствует внутренняя часть «${partName}».`
      );
    }
    const parsed = parseWorksheet(
      await readEntryText(zipFile, entry, maximumPartBytes),
      partName,
      sheet,
      sharedStrings,
      sourceSha256,
      budget
    );
    sheets.push(parsed.sheet);
    cellCount += parsed.cellCount;
  }
  return { xlsx: { sheets }, cells: cellCount };
}

export async function analyzeOoxmlBuffer(
  input: AnalyzeOoxmlInput
): Promise<DocumentAnalysisResult> {
  const intake = await inspectOoxmlBuffer(input);
  if (intake.decision === "rejected") {
    throw new DocumentIntakeError(
      "document_not_safe_for_analysis",
      422,
      "Структурный анализ недоступен: сначала устраните блокирующие замечания проверки."
    );
  }

  const maximumElements = positiveBoundedInteger(
    input.maxElements,
    DEFAULT_MAX_ELEMENTS,
    MAX_ALLOWED_ELEMENTS,
    "число элементов"
  );
  const maximumPartBytes = positiveBoundedInteger(
    input.maxStructurePartBytes,
    DEFAULT_MAX_STRUCTURE_PART_BYTES,
    DEFAULT_INTAKE_LIMITS.maxEntryUncompressedBytes,
    "размер структурной части"
  );
  const budget: StructureBudget = { limit: maximumElements, returned: 0 };
  const { zipFile, entries } = await collectEntries(input.buffer);
  try {
    if (intake.format === "docx") {
      const parsed = await buildDocxStructure(
        zipFile,
        entries,
        intake.sha256,
        budget,
        maximumPartBytes
      );
      const totalElements = parsed.paragraphs;
      return {
        intake,
        structure: {
          version: 1,
          fileName: intake.fileName,
          format: intake.format,
          sourceSha256: intake.sha256,
          truncated: budget.returned < totalElements,
          totals: {
            structuralParts: parsed.docx.parts.length,
            paragraphs: parsed.paragraphs,
            runs: parsed.runs,
            sheets: 0,
            cells: 0,
            returnedElements: budget.returned
          },
          docx: parsed.docx
        }
      };
    }

    const parsed = await buildXlsxStructure(
      zipFile,
      entries,
      intake.sha256,
      budget,
      maximumPartBytes
    );
    return {
      intake,
      structure: {
        version: 1,
        fileName: intake.fileName,
        format: intake.format,
        sourceSha256: intake.sha256,
        truncated: budget.returned < parsed.cells,
        totals: {
          structuralParts: parsed.xlsx.sheets.length,
          paragraphs: 0,
          runs: 0,
          sheets: parsed.xlsx.sheets.length,
          cells: parsed.cells,
          returnedElements: budget.returned
        },
        xlsx: parsed.xlsx
      }
    };
  } finally {
    zipFile.close();
  }
}
