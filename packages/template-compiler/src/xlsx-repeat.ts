import { createHash } from "node:crypto";

import {
  TemplateCompilerError,
  type CompiledTechnicalBinding,
  type ScalarFieldBinding,
  type XlsxCellBinding
} from "./compiler.js";
import { formatScalarDisplay, type ScalarValueType } from "./scalar-formatter.js";
import {
  normalizeScalarValueForRendering,
  type NormalizedScalarValue
} from "./scalar-render.js";
import {
  packageEntry,
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackageEntry
} from "./ooxml-package.js";
import {
  translateSafeXlsxFormula,
  type SafeXlsxFormulaArea
} from "./xlsx-formula.js";

const MAX_COLUMN = 16_384;
const MAX_ROW = 1_048_576;
const MAX_FIELDS = 100;
const MAX_MEMBERS = 1_000;
const MAX_MERGES = 10_000;
const MAX_WORKSHEET_BYTES = 32 * 1024 * 1024;
const WORKBOOK_PART = "xl/workbook.xml";
const CONTENT_TYPES_PART = "[Content_Types].xml";
const WORKBOOK_RELATIONSHIPS_PART = "xl/_rels/workbook.xml.rels";
const CALC_CHAIN_PART = "xl/calcChain.xml";
const CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const PACKAGE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const SPREADSHEET_NAMESPACE =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

export interface XlsxRepeatRowBinding {
  version: 1;
  kind: "xlsx.repeat-row";
  source: "audience.members";
  selection: "used-row" | "range";
  sheetName: string;
  sheetPath: string;
  rowNumber: number;
  startAddress: string;
  endAddress: string;
  startElementId: string;
  endElementId: string;
}

export interface XlsxRepeatTechnicalBinding {
  kind: "xlsx.repeat-defined-name";
  identifier: string;
  part: "xl/workbook.xml";
  target: string;
}

export interface XlsxRepeatRowContract {
  version: 1;
  kind: "xlsx.repeat-row-contract";
  binding: XlsxRepeatRowBinding;
  technicalBinding: XlsxRepeatTechnicalBinding;
}

export interface CompileXlsxRepeatField {
  fieldId: string;
  technicalBinding: CompiledTechnicalBinding;
  fieldBinding: ScalarFieldBinding;
}

export interface CompileXlsxRepeatRowInput {
  compiled: Uint8Array;
  binding: unknown;
  fields: readonly CompileXlsxRepeatField[];
}

export interface CompileXlsxRepeatRowResult {
  output: Buffer;
  inputSha256: string;
  outputSha256: string;
  modifiedPart: "xl/workbook.xml";
  binding: XlsxRepeatRowBinding;
  technicalBinding: XlsxRepeatTechnicalBinding;
  verification: {
    found: true;
    fieldCount: number;
    message: string;
  };
}

export interface RenderXlsxRepeatField {
  fieldId: string;
  fieldKey: string;
  required: boolean;
  technicalBinding: CompiledTechnicalBinding;
  fieldBinding: ScalarFieldBinding;
  valueType: ScalarValueType;
  formatter?: unknown;
}

export interface RenderXlsxRepeatMember {
  memberId: string;
  values: readonly unknown[];
}

export interface RenderXlsxRepeatRowsInput {
  compiled: Uint8Array;
  binding: XlsxRepeatRowBinding;
  technicalBinding: XlsxRepeatTechnicalBinding;
  fields: readonly RenderXlsxRepeatField[];
  members: readonly RenderXlsxRepeatMember[];
}

export interface RenderXlsxRepeatRowsResult {
  output: Buffer;
  inputSha256: string;
  outputSha256: string;
  modifiedParts: string[];
  rowCount: number;
  fieldCount: number;
  verification: {
    matched: true;
    checkedValues: number;
    checkedFormulas: number;
    message: string;
  };
}

interface XmlTag {
  start: number;
  end: number;
  name: string;
  localName: string;
  closing: boolean;
  selfClosing: boolean;
  raw: string;
}

interface DecodedXml {
  text: string;
  encoding: "utf8" | "utf16le" | "utf16be";
  bom: boolean;
}

interface ElementRange {
  openIndex: number;
  closeIndex: number;
  open: XmlTag;
  close: XmlTag;
}

interface CellAddress {
  address: string;
  columnName: string;
  column: number;
  row: number;
}

interface WorksheetCell {
  address: CellAddress;
  xml: string;
  styleIndex: number;
  type: string;
  formula: string | null;
}

interface WorksheetRow {
  rowNumber: number;
  start: number;
  end: number;
  xml: string;
  cells: WorksheetCell[];
  opening: string;
  closing: string;
  hidden: boolean;
}

interface CellRange {
  start: CellAddress;
  end: CellAddress;
}

interface WorksheetModel {
  xml: string;
  rows: WorksheetRow[];
  merges: CellRange[];
  formulas: Array<{ row: number; address: string; formula: string }>;
  styleCount: number;
  sharedStringCount: number;
}

interface NormalizedRepeatField {
  fieldId: string;
  fieldKey: string;
  required: boolean;
  technicalBinding: CompiledTechnicalBinding;
  fieldBinding: XlsxCellBinding;
  valueType: ScalarValueType;
  formatter?: unknown;
  column: number;
}

interface ExpectedFormula {
  address: string;
  formula: string;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new TemplateCompilerError(
      "invalid_repeat_binding",
      `${label} содержит неизвестные поля: ${unexpected.join(", ")}.`
    );
  }
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TemplateCompilerError(
      "invalid_repeat_binding",
      `Значение «${label}» имеет недопустимый формат.`
    );
  }
  return value;
}

function requiredInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TemplateCompilerError(
      "invalid_repeat_binding",
      `Координата «${label}» находится за пределами XLSX.`
    );
  }
  return value;
}

function columnNumber(column: string): number {
  let value = 0;
  for (const character of column) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value;
}

function columnName(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > MAX_COLUMN) {
    throw new TemplateCompilerError(
      "invalid_cell_address",
      "Столбец находится за пределами XLSX."
    );
  }
  let current = value;
  let result = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function parseCellAddress(value: unknown, label = "адрес ячейки"): CellAddress {
  const text = requiredText(value, label, 16).toUpperCase();
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(text);
  if (match === null) {
    throw new TemplateCompilerError(
      "invalid_cell_address",
      `Значение «${label}» не является адресом ячейки XLSX.`
    );
  }
  const columnText = match[1] ?? "";
  const column = columnNumber(columnText);
  const row = Number(match[2]);
  if (column < 1 || column > MAX_COLUMN || row < 1 || row > MAX_ROW) {
    throw new TemplateCompilerError(
      "invalid_cell_address",
      `Значение «${label}» находится за пределами XLSX.`
    );
  }
  return { address: `${columnText}${row}`, columnName: columnText, column, row };
}

function parseRange(value: string, label: string): CellRange {
  const match = /^([A-Z]{1,3}[1-9][0-9]{0,6}):([A-Z]{1,3}[1-9][0-9]{0,6})$/u.exec(
    value.toUpperCase()
  );
  if (match === null) {
    throw new TemplateCompilerError(
      "invalid_repeat_range",
      `${label} содержит недопустимый диапазон XLSX.`
    );
  }
  const start = parseCellAddress(match[1], `${label}: начало`);
  const end = parseCellAddress(match[2], `${label}: конец`);
  if (start.column > end.column || start.row > end.row) {
    throw new TemplateCompilerError(
      "invalid_repeat_range",
      `${label} содержит диапазон в обратном порядке.`
    );
  }
  return { start, end };
}

function quoteSheetName(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

function absoluteAddress(address: CellAddress): string {
  return `$${address.columnName}$${address.row}`;
}

function repeatTarget(binding: XlsxRepeatRowBinding): string {
  return `${quoteSheetName(binding.sheetName)}!${absoluteAddress(
    parseCellAddress(binding.startAddress)
  )}:${absoluteAddress(parseCellAddress(binding.endAddress))}`;
}

function repeatIdentifier(binding: XlsxRepeatRowBinding): string {
  const suffix = createHash("sha256")
    .update(binding.sheetPath)
    .update("\u0000")
    .update(String(binding.rowNumber))
    .update("\u0000")
    .update(binding.startAddress)
    .update("\u0000")
    .update(binding.endAddress)
    .update("\u0000")
    .update(binding.source)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `_DOCOMATOR_REPEAT_${suffix}`;
}

function safeFormulaArea(binding: XlsxRepeatRowBinding): SafeXlsxFormulaArea {
  return {
    repeatRow: binding.rowNumber,
    startColumn: parseCellAddress(binding.startAddress).column,
    endColumn: parseCellAddress(binding.endAddress).column
  };
}

export function parseXlsxRepeatRowBinding(value: unknown): XlsxRepeatRowBinding {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    value.kind !== "xlsx.repeat-row" ||
    value.source !== "audience.members" ||
    (value.selection !== "used-row" && value.selection !== "range")
  ) {
    throw new TemplateCompilerError(
      "invalid_repeat_binding",
      "Сохранённая повторяемая строка XLSX имеет неподдерживаемый формат."
    );
  }
  exactKeys(
    value,
    [
      "version",
      "kind",
      "source",
      "selection",
      "sheetName",
      "sheetPath",
      "rowNumber",
      "startAddress",
      "endAddress",
      "startElementId",
      "endElementId"
    ],
    "Привязка повторяемой строки XLSX"
  );
  const rowNumber = requiredInteger(
    value.rowNumber,
    "номер строки",
    1,
    MAX_ROW
  );
  const start = parseCellAddress(value.startAddress, "начальная ячейка");
  const end = parseCellAddress(value.endAddress, "конечная ячейка");
  if (
    start.row !== rowNumber ||
    end.row !== rowNumber ||
    start.column > end.column
  ) {
    throw new TemplateCompilerError(
      "invalid_repeat_range",
      "Повторяемый диапазон XLSX должен быть непрерывным и находиться в одной строке."
    );
  }
  return {
    version: 1,
    kind: "xlsx.repeat-row",
    source: "audience.members",
    selection: value.selection,
    sheetName: requiredText(value.sheetName, "название листа", 255),
    sheetPath: requiredText(value.sheetPath, "часть листа", 500),
    rowNumber,
    startAddress: start.address,
    endAddress: end.address,
    startElementId: requiredText(
      value.startElementId,
      "начальный элемент",
      160
    ),
    endElementId: requiredText(value.endElementId, "конечный элемент", 160)
  };
}

export function parseXlsxRepeatRowContract(value: unknown): XlsxRepeatRowContract {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    value.kind !== "xlsx.repeat-row-contract" ||
    !isObject(value.technicalBinding)
  ) {
    throw new TemplateCompilerError(
      "invalid_repeat_contract",
      "Сохранённый контракт повторяемой строки XLSX имеет неподдерживаемый формат."
    );
  }
  exactKeys(
    value,
    ["version", "kind", "binding", "technicalBinding"],
    "Контракт повторяемой строки XLSX"
  );
  exactKeys(
    value.technicalBinding,
    ["kind", "identifier", "part", "target"],
    "Техническая привязка повторяемой строки XLSX"
  );
  const binding = parseXlsxRepeatRowBinding(value.binding);
  const identifier = requiredText(
    value.technicalBinding.identifier,
    "техническое имя повтора XLSX",
    80
  );
  const part = requiredText(
    value.technicalBinding.part,
    "часть технической привязки XLSX",
    80
  );
  const target = requiredText(
    value.technicalBinding.target,
    "диапазон технической привязки XLSX",
    600
  );
  if (
    value.technicalBinding.kind !== "xlsx.repeat-defined-name" ||
    identifier !== repeatIdentifier(binding) ||
    part !== WORKBOOK_PART ||
    target !== repeatTarget(binding)
  ) {
    throw new TemplateCompilerError(
      "invalid_repeat_contract",
      "Техническая привязка XLSX не соответствует сохранённому диапазону."
    );
  }
  return {
    version: 1,
    kind: "xlsx.repeat-row-contract",
    binding,
    technicalBinding: {
      kind: "xlsx.repeat-defined-name",
      identifier,
      part: WORKBOOK_PART,
      target
    }
  };
}

function decodeXml(buffer: Buffer): DecodedXml {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return {
      text: buffer.subarray(2).toString("utf16le"),
      encoding: "utf16le",
      bom: true
    };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2);
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1] ?? 0;
      swapped[index - 1] = buffer[index] ?? 0;
    }
    return { text: swapped.toString("utf16le"), encoding: "utf16be", bom: true };
  }
  const bom =
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf;
  return {
    text: buffer.subarray(bom ? 3 : 0).toString("utf8"),
    encoding: "utf8",
    bom
  };
}

function encodeXml(decoded: DecodedXml, text: string): Buffer {
  if (decoded.encoding === "utf8") {
    const content = Buffer.from(text, "utf8");
    return decoded.bom
      ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content])
      : content;
  }
  const littleEndian = Buffer.from(text, "utf16le");
  if (decoded.encoding === "utf16le") {
    return decoded.bom
      ? Buffer.concat([Buffer.from([0xff, 0xfe]), littleEndian])
      : littleEndian;
  }
  const bigEndian = Buffer.allocUnsafe(littleEndian.length);
  for (let index = 0; index + 1 < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1] ?? 0;
    bigEndian[index + 1] = littleEndian[index] ?? 0;
  }
  return decoded.bom
    ? Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian])
    : bigEndian;
}

function localName(name: string): string {
  const separator = name.lastIndexOf(":");
  return separator < 0 ? name : name.slice(separator + 1);
}

function findTagEnd(xml: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index] ?? "";
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function invalidXml(): never {
  throw new TemplateCompilerError(
    "invalid_xml",
    "Одна из XML-частей книги XLSX повреждена."
  );
}

function scanXmlTags(xml: string): XmlTag[] {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new TemplateCompilerError(
      "unsafe_xml_declaration",
      "Книга содержит запрещённое объявление XML."
    );
  }
  const tags: XmlTag[] = [];
  let index = 0;
  while (index < xml.length) {
    const opening = xml.indexOf("<", index);
    if (opening < 0) break;
    if (xml.startsWith("<!--", opening)) {
      const closing = xml.indexOf("-->", opening + 4);
      if (closing < 0) invalidXml();
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<?", opening)) {
      const closing = xml.indexOf("?>", opening + 2);
      if (closing < 0) invalidXml();
      index = closing + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", opening)) {
      const closing = xml.indexOf("]]>", opening + 9);
      if (closing < 0) invalidXml();
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<!", opening)) {
      throw new TemplateCompilerError(
        "unsafe_xml_declaration",
        "Книга содержит неподдерживаемое объявление XML."
      );
    }
    const closingIndex = findTagEnd(xml, opening + 1);
    if (closingIndex < 0) invalidXml();
    const raw = xml.slice(opening + 1, closingIndex).trim();
    const closing = raw.startsWith("/");
    const selfClosing = !closing && raw.endsWith("/");
    const source = closing
      ? raw.slice(1).trim()
      : selfClosing
        ? raw.slice(0, -1).trimEnd()
        : raw;
    const name = source.split(/\s/u, 1)[0] ?? "";
    if (name.length === 0) invalidXml();
    tags.push({
      start: opening,
      end: closingIndex + 1,
      name,
      localName: localName(name),
      closing,
      selfClosing,
      raw
    });
    index = closingIndex + 1;
  }
  return tags;
}

function validateRootNamespace(
  xml: string,
  rootName: string,
  namespace: string,
  label: string
): void {
  const tags = scanXmlTags(xml);
  const rootIndex = tags.findIndex((tag) => !tag.closing);
  const root = tags[rootIndex];
  if (
    root === undefined ||
    root.name !== rootName ||
    root.selfClosing ||
    attributeValue(root.raw, "xmlns") !== namespace ||
    tags.some((tag) => tag.name.includes(":")) ||
    tags.some((tag, index) => {
      if (tag.closing || index === rootIndex) return false;
      const declared = attributeValue(tag.raw, "xmlns");
      return declared !== null && declared !== namespace;
    })
  ) {
    throw new TemplateCompilerError(
      "unsupported_xlsx_namespace",
      `${label} использует неподдерживаемое пространство имён XML.`
    );
  }
  const rootCloseIndex = matchingCloseIndex(tags, rootIndex);
  if (rootCloseIndex !== tags.length - 1) invalidXml();
}

function matchingCloseIndex(tags: readonly XmlTag[], openingIndex: number): number {
  const opening = tags[openingIndex];
  if (opening === undefined || opening.closing) invalidXml();
  if (opening.selfClosing) return openingIndex;
  let depth = 1;
  for (let index = openingIndex + 1; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag === undefined || tag.name !== opening.name) continue;
    if (!tag.closing && !tag.selfClosing) depth += 1;
    else if (tag.closing) depth -= 1;
    if (depth === 0) return index;
  }
  return invalidXml();
}

function directChildren(
  tags: readonly XmlTag[],
  parentOpenIndex: number,
  parentCloseIndex: number
): ElementRange[] {
  const children: ElementRange[] = [];
  let index = parentOpenIndex + 1;
  while (index < parentCloseIndex) {
    const open = tags[index];
    if (open === undefined || open.closing) invalidXml();
    const closeIndex = matchingCloseIndex(tags, index);
    const close = tags[closeIndex];
    if (close === undefined || closeIndex > parentCloseIndex) invalidXml();
    children.push({ openIndex: index, closeIndex, open, close });
    index = closeIndex + 1;
  }
  return children;
}

function findElements(xml: string, wanted: string): ElementRange[] {
  const tags = scanXmlTags(xml);
  const result: ElementRange[] = [];
  for (let index = 0; index < tags.length; index += 1) {
    const open = tags[index];
    if (open === undefined || open.closing || open.localName !== wanted) continue;
    const closeIndex = matchingCloseIndex(tags, index);
    const close = tags[closeIndex];
    if (close === undefined) invalidXml();
    result.push({ openIndex: index, closeIndex, open, close });
    index = closeIndex;
  }
  return result;
}

function firstElement(xml: string, wanted: string): ElementRange {
  const element = findElements(xml, wanted)[0];
  if (element === undefined) {
    throw new TemplateCompilerError(
      "xlsx_structure_missing",
      `В книге не найден обязательный элемент «${wanted}».`
    );
  }
  return element;
}

function attributeValue(rawTag: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const expression = new RegExp(
    `(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`,
    "u"
  );
  const value = expression.exec(rawTag)?.[2];
  return value === undefined ? null : decodeXmlText(value);
}

function xmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function xmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function decodeXmlText(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/giu,
    (_source, entity: string) => {
      if (entity === "amp") return "&";
      if (entity === "lt") return "<";
      if (entity === "gt") return ">";
      if (entity === "quot") return '"';
      if (entity === "apos") return "'";
      const hexadecimal = entity.toLowerCase().startsWith("#x");
      const digits = entity.slice(hexadecimal ? 2 : 1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        throw new TemplateCompilerError(
          "invalid_xml_entity",
          "В книге обнаружена недопустимая XML-сущность."
        );
      }
      return String.fromCodePoint(codePoint);
    }
  );
}

function removeAttribute(openingTag: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return openingTag.replace(
    new RegExp(`\\s+${escapedName}\\s*=\\s*(["']).*?\\1`, "gu"),
    ""
  );
}

function setAttribute(openingTag: string, name: string, value: string): string {
  const selfClosing = /\/>$/u.test(openingTag);
  const without = removeAttribute(openingTag, name).replace(
    selfClosing ? /\/>$/u : />$/u,
    ""
  );
  return `${without} ${name}="${xmlAttribute(value)}"${selfClosing ? "/>" : ">"}`;
}

function setCellType(openingTag: string, type: string | null): string {
  const without = removeAttribute(openingTag, "t");
  return type === null ? without : setAttribute(without, "t", type);
}

function replaceEntry(
  entries: readonly OoxmlPackageEntry[],
  name: string,
  content: Buffer
): OoxmlPackageEntry[] {
  let found = false;
  const result = entries.map((entry) => {
    if (entry.name !== name) return entry;
    found = true;
    return { ...entry, content };
  });
  if (!found) {
    throw new TemplateCompilerError(
      "compiled_part_not_found",
      `В книге не найдена часть «${name}».`
    );
  }
  return result;
}

function applyReplacements(
  value: string,
  replacements: readonly { start: number; end: number; value: string }[]
): string {
  let result = value;
  let boundary = value.length;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    if (
      replacement.start < 0 ||
      replacement.end < replacement.start ||
      replacement.end > boundary
    ) {
      invalidXml();
    }
    result =
      result.slice(0, replacement.start) +
      replacement.value +
      result.slice(replacement.end);
    boundary = replacement.start;
  }
  return result;
}

function elementText(xml: string, range: ElementRange): string {
  if (range.open.selfClosing) return "";
  return decodeXmlText(xml.slice(range.open.end, range.close.start));
}

function tagPrefix(name: string): string {
  const separator = name.lastIndexOf(":");
  return separator < 0 ? "" : `${name.slice(0, separator)}:`;
}

function integerAttribute(
  rawTag: string,
  name: string,
  label: string,
  minimum: number,
  maximum: number,
  fallback?: number
): number {
  const raw = attributeValue(rawTag, name);
  if (raw === null && fallback !== undefined) return fallback;
  if (raw === null || !/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
    throw new TemplateCompilerError(
      "invalid_xlsx_structure",
      `Атрибут «${label}» имеет недопустимое значение.`
    );
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TemplateCompilerError(
      "invalid_xlsx_structure",
      `Атрибут «${label}» находится за допустимыми пределами.`
    );
  }
  return value;
}

function booleanAttribute(
  rawTag: string,
  name: string,
  label: string,
  fallback = false
): boolean {
  const raw = attributeValue(rawTag, name);
  if (raw === null) return fallback;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new TemplateCompilerError(
    "invalid_xlsx_structure",
    `Атрибут «${label}» имеет недопустимое логическое значение.`
  );
}

function directNamedChildren(
  xml: string,
  parentName: string,
  childName: string
): ElementRange[] {
  const tags = scanXmlTags(xml);
  const parentIndex = tags.findIndex(
    (tag) => !tag.closing && tag.localName === parentName
  );
  if (parentIndex < 0) return [];
  const parentCloseIndex = matchingCloseIndex(tags, parentIndex);
  return directChildren(tags, parentIndex, parentCloseIndex).filter(
    ({ open }) => open.localName === childName
  );
}

function styleCount(entries: readonly OoxmlPackageEntry[]): number {
  const styles = entries.find((entry) => entry.name === "xl/styles.xml");
  if (styles === undefined) return 1;
  const decoded = decodeXml(styles.content);
  validateRootNamespace(
    decoded.text,
    "styleSheet",
    SPREADSHEET_NAMESPACE,
    "Таблица стилей XLSX"
  );
  const xfs = directNamedChildren(decoded.text, "cellXfs", "xf");
  if (xfs.length === 0) {
    throw new TemplateCompilerError(
      "invalid_xlsx_styles",
      "В книге отсутствует обязательный базовый стиль ячеек."
    );
  }
  return xfs.length;
}

function sharedStringCount(entries: readonly OoxmlPackageEntry[]): number {
  const shared = entries.find((entry) => entry.name === "xl/sharedStrings.xml");
  if (shared === undefined) return 0;
  const decoded = decodeXml(shared.content);
  validateRootNamespace(
    decoded.text,
    "sst",
    SPREADSHEET_NAMESPACE,
    "Таблица общих строк XLSX"
  );
  return directNamedChildren(decoded.text, "sst", "si").length;
}

function cellChildren(cellXml: string): ElementRange[] {
  const tags = scanXmlTags(cellXml);
  const cellIndex = tags.findIndex(
    (tag) => !tag.closing && tag.localName === "c"
  );
  if (cellIndex < 0) invalidXml();
  const closeIndex = matchingCloseIndex(tags, cellIndex);
  return directChildren(tags, cellIndex, closeIndex);
}

function cellFormula(cellXml: string): string | null {
  const formula = cellChildren(cellXml).find(
    ({ open }) => open.localName === "f"
  );
  if (formula === undefined) return null;
  if (
    formula.open.selfClosing ||
    attributeValue(formula.open.raw, "t") !== null ||
    attributeValue(formula.open.raw, "si") !== null ||
    attributeValue(formula.open.raw, "ref") !== null ||
    formula.open.raw.trim() !== formula.open.name
  ) {
    throw new TemplateCompilerError(
      "unsafe_repeat_formula",
      "Общие, массивные и табличные формулы нельзя использовать в повторяемой строке."
    );
  }
  return elementText(cellXml, formula);
}

function directTextValues(xml: string, wanted: string): string[] {
  return findElements(xml, wanted).map((range) => elementText(xml, range));
}

function cellRawValue(cellXml: string): string {
  return directTextValues(cellXml, "v")[0] ?? "";
}

function validateSharedString(cell: WorksheetCell, count: number): void {
  if (cell.type !== "s") return;
  const raw = cellRawValue(cell.xml);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw) || Number(raw) >= count) {
    throw new TemplateCompilerError(
      "invalid_shared_string",
      `Ячейка «${cell.address.address}» содержит недопустимую ссылку на общую строку.`
    );
  }
}

function parseRow(
  xml: string,
  range: ElementRange,
  styleTotal: number,
  sharedTotal: number
): WorksheetRow {
  const rowNumber = integerAttribute(
    range.open.raw,
    "r",
    "номер строки",
    1,
    MAX_ROW
  );
  if (range.open.selfClosing) {
    throw new TemplateCompilerError(
      "invalid_repeat_row",
      `Строка ${rowNumber} не содержит ячеек и не может быть образцом.`
    );
  }
  const rowXml = xml.slice(range.open.start, range.close.end);
  const rowTags = scanXmlTags(rowXml);
  const rowIndex = rowTags.findIndex(
    (tag) => !tag.closing && tag.localName === "row"
  );
  if (rowIndex < 0) invalidXml();
  const rowCloseIndex = matchingCloseIndex(rowTags, rowIndex);
  const children = directChildren(rowTags, rowIndex, rowCloseIndex);
  if (children.some(({ open }) => open.localName !== "c")) {
    throw new TemplateCompilerError(
      "unsupported_repeat_row",
      `Строка ${rowNumber} содержит неподдерживаемые дочерние элементы.`
    );
  }
  const cells = children.map((child) => {
    const cellXml = rowXml.slice(child.open.start, child.close.end);
    const address = parseCellAddress(
      attributeValue(child.open.raw, "r"),
      `адрес ячейки строки ${rowNumber}`
    );
    if (address.row !== rowNumber) {
      throw new TemplateCompilerError(
        "cell_row_mismatch",
        `Ячейка «${address.address}» не соответствует строке ${rowNumber}.`
      );
    }
    const styleIndex = integerAttribute(
      child.open.raw,
      "s",
      `стиль ячейки ${address.address}`,
      0,
      Math.max(0, styleTotal - 1),
      0
    );
    const cell: WorksheetCell = {
      address,
      xml: cellXml,
      styleIndex,
      type: attributeValue(child.open.raw, "t") ?? "n",
      formula: cellFormula(cellXml)
    };
    validateSharedString(cell, sharedTotal);
    return cell;
  });
  const columns = cells.map((cell) => cell.address.column);
  if (
    new Set(columns).size !== columns.length ||
    columns.some((column, index) => index > 0 && column <= (columns[index - 1] ?? 0))
  ) {
    throw new TemplateCompilerError(
      "duplicate_or_unsorted_cells",
      `Строка ${rowNumber} содержит повторяющиеся или неупорядоченные ячейки.`
    );
  }
  return {
    rowNumber,
    start: range.open.start,
    end: range.close.end,
    xml: rowXml,
    cells,
    opening: rowXml.slice(0, rowTags[rowIndex]?.end ?? 0),
    closing: rowXml.slice(rowTags[rowCloseIndex]?.start ?? rowXml.length),
    hidden: booleanAttribute(
      range.open.raw,
      "hidden",
      `скрытая строка ${rowNumber}`
    )
  };
}

function rangesOverlap(left: CellRange, right: CellRange): boolean {
  return !(
    left.end.column < right.start.column ||
    right.end.column < left.start.column ||
    left.end.row < right.start.row ||
    right.end.row < left.start.row
  );
}

function worksheetMerges(xml: string): CellRange[] {
  const containers = findElements(xml, "mergeCells");
  if (containers.length > 1) {
    throw new TemplateCompilerError(
      "invalid_merged_cells",
      "В листе найдено несколько секций объединённых ячеек."
    );
  }
  const container = containers[0];
  if (container === undefined) return [];
  const tags = scanXmlTags(xml);
  const children = directChildren(tags, container.openIndex, container.closeIndex);
  if (
    children.length > MAX_MERGES ||
    children.some(({ open }) => open.localName !== "mergeCell")
  ) {
    throw new TemplateCompilerError(
      "invalid_merged_cells",
      "Объединённые ячейки листа имеют неподдерживаемую структуру."
    );
  }
  const ranges = children.map(({ open }) =>
    parseRange(attributeValue(open.raw, "ref") ?? "", "Объединение")
  );
  for (let left = 0; left < ranges.length; left += 1) {
    for (let right = left + 1; right < ranges.length; right += 1) {
      const leftRange = ranges[left];
      const rightRange = ranges[right];
      if (
        leftRange !== undefined &&
        rightRange !== undefined &&
        rangesOverlap(leftRange, rightRange)
      ) {
        throw new TemplateCompilerError(
          "overlapping_merged_cells",
          "Лист содержит пересекающиеся объединённые ячейки."
        );
      }
    }
  }
  return ranges;
}

function validateWorksheetFeatures(xml: string): void {
  const unsupported = new Map<string, string>([
    ["autoFilter", "автофильтр"],
    ["conditionalFormatting", "условное форматирование"],
    ["dataValidations", "проверка данных"],
    ["drawing", "рисунок"],
    ["legacyDrawing", "устаревший рисунок"],
    ["hyperlinks", "гиперссылка"],
    ["oleObjects", "OLE-объект"],
    ["controls", "элемент управления"],
    ["rowBreaks", "разрыв строки"],
    ["colBreaks", "разрыв столбца"],
    ["tableParts", "таблица Excel"],
    ["sheetProtection", "защита листа"]
  ]);
  const tags = scanXmlTags(xml);
  for (const [local, label] of unsupported) {
    if (tags.some((tag) => !tag.closing && tag.localName === local)) {
      throw new TemplateCompilerError(
        "unsupported_xlsx_repeat_feature",
        `Повторяемая строка пока несовместима с элементом «${label}». Уберите его из выбранного листа или используйте обычный сводный шаблон.`
      );
    }
  }
}

function worksheetModel(
  entries: readonly OoxmlPackageEntry[],
  binding: XlsxRepeatRowBinding,
  formulaRowStart = binding.rowNumber,
  formulaRowEnd = formulaRowStart
): WorksheetModel {
  const sheet = packageEntry(entries, binding.sheetPath);
  const decoded = decodeXml(sheet.content);
  validateRootNamespace(
    decoded.text,
    "worksheet",
    SPREADSHEET_NAMESPACE,
    "Выбранный лист XLSX"
  );
  validateWorksheetFeatures(decoded.text);
  const tags = scanXmlTags(decoded.text);
  const sheetDataIndex = tags.findIndex(
    (tag) => !tag.closing && tag.localName === "sheetData"
  );
  if (sheetDataIndex < 0) {
    throw new TemplateCompilerError(
      "worksheet_data_missing",
      "В выбранном листе отсутствуют строки с данными."
    );
  }
  const sheetDataCloseIndex = matchingCloseIndex(tags, sheetDataIndex);
  const rowRanges = directChildren(tags, sheetDataIndex, sheetDataCloseIndex);
  if (rowRanges.some(({ open }) => open.localName !== "row")) invalidXml();
  const styles = styleCount(entries);
  const shared = sharedStringCount(entries);
  const rows = rowRanges.map((range) =>
    parseRow(decoded.text, range, styles, shared)
  );
  const rowNumbers = rows.map((row) => row.rowNumber);
  if (
    new Set(rowNumbers).size !== rowNumbers.length ||
    rowNumbers.some(
      (row, index) => index > 0 && row <= (rowNumbers[index - 1] ?? 0)
    )
  ) {
    throw new TemplateCompilerError(
      "duplicate_or_unsorted_rows",
      "Лист содержит повторяющиеся или неупорядоченные строки."
    );
  }
  const formulas = rows.flatMap((row) =>
    row.cells.flatMap((cell) =>
      cell.formula === null
        ? []
        : [{ row: row.rowNumber, address: cell.address.address, formula: cell.formula }]
    )
  );
  for (const formula of formulas) {
    translateSafeXlsxFormula(
      formula.formula,
      formula.row,
      formula.row,
      safeFormulaArea(binding)
    );
    if (formula.row < formulaRowStart || formula.row > formulaRowEnd) {
      throw new TemplateCompilerError(
        "formula_outside_repeat_not_supported",
        `Формула в ячейке «${formula.address}» находится вне повторяемой строки и не может быть безопасно преобразована.`
      );
    }
  }
  return {
    xml: decoded.text,
    rows,
    merges: worksheetMerges(decoded.text),
    formulas,
    styleCount: styles,
    sharedStringCount: shared
  };
}

function validatePackageSecurity(entries: readonly OoxmlPackageEntry[]): void {
  if (
    entries.some(
      (entry) => {
        const name = entry.name.toLowerCase();
        return (
          name.startsWith("_xmlsignatures/") ||
          name.startsWith("xl/externallinks/") ||
          /vbaproject|activex|embeddings\//u.test(name)
        );
      }
    )
  ) {
    throw new TemplateCompilerError(
      "unsafe_xlsx_repeat_package",
      "Структурное заполнение недоступно для книги с подписями, внешними книгами, макросами или внедрёнными объектами."
    );
  }
  const contentTypes = decodeXml(
    packageEntry(entries, CONTENT_TYPES_PART).content
  ).text;
  validateRootNamespace(
    contentTypes,
    "Types",
    CONTENT_TYPES_NAMESPACE,
    "Типы частей XLSX"
  );
  if (
    [...findElements(contentTypes, "Default"), ...findElements(contentTypes, "Override")]
      .map((range) =>
        (attributeValue(range.open.raw, "ContentType") ?? "").toLowerCase()
      )
      .some((contentType) =>
        /macroenabled|vbaproject|activex|digital-signature/u.test(contentType)
      )
  ) {
    throw new TemplateCompilerError(
      "unsafe_xlsx_repeat_package",
      "Структурное заполнение недоступно для книги с макросами, ActiveX или цифровой подписью."
    );
  }
  for (const entry of entries.filter((candidate) => candidate.name.endsWith(".rels"))) {
    const decoded = decodeXml(entry.content);
    validateRootNamespace(
      decoded.text,
      "Relationships",
      PACKAGE_RELATIONSHIPS_NAMESPACE,
      `Связи «${entry.name}»`
    );
    if (
      scanXmlTags(decoded.text).some(
        (tag) =>
          !tag.closing &&
          tag.localName === "Relationship" &&
          (attributeValue(tag.raw, "TargetMode") ?? "").toLowerCase() ===
            "external"
      )
    ) {
      throw new TemplateCompilerError(
        "external_relationship_not_supported",
        "Повторяемая строка недоступна для книги с внешними связями."
      );
    }
  }
}

function resolveWorkbookTarget(target: string): string {
  if (
    target.length === 0 ||
    target.startsWith("/") ||
    target.startsWith("\\") ||
    target.includes("\\")
  ) {
    throw new TemplateCompilerError(
      "invalid_worksheet_relationship",
      "Связь выбранного листа содержит недопустимый путь."
    );
  }
  const segments = target.replace(/^\.\//u, "").split("/");
  const resolved = ["xl"];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length <= 1) {
        throw new TemplateCompilerError(
          "invalid_worksheet_relationship",
          "Связь выбранного листа выходит за каталог XLSX."
        );
      }
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

function validateWorksheetRelationship(
  entries: readonly OoxmlPackageEntry[],
  binding: XlsxRepeatRowBinding
): void {
  const workbook = decodeXml(packageEntry(entries, WORKBOOK_PART).content).text;
  validateRootNamespace(
    workbook,
    "workbook",
    SPREADSHEET_NAMESPACE,
    "Книга XLSX"
  );
  const sheets = findElements(workbook, "sheet").filter(
    ({ open }) => attributeValue(open.raw, "name") === binding.sheetName
  );
  if (sheets.length !== 1) {
    throw new TemplateCompilerError(
      "worksheet_relationship_mismatch",
      "Название выбранного листа не найдено в книге ровно один раз."
    );
  }
  const relationshipId =
    attributeValue(sheets[0]?.open.raw ?? "", "r:id") ??
    attributeValue(sheets[0]?.open.raw ?? "", "id");
  if (relationshipId === null) invalidXml();
  const relationships = decodeXml(
    packageEntry(entries, WORKBOOK_RELATIONSHIPS_PART).content
  ).text;
  const relations = findElements(relationships, "Relationship").filter(
    ({ open }) => attributeValue(open.raw, "Id") === relationshipId
  );
  const relation = relations[0];
  if (
    relations.length !== 1 ||
    relation === undefined ||
    attributeValue(relation.open.raw, "Type") !==
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ||
    attributeValue(relation.open.raw, "TargetMode") !== null ||
    resolveWorkbookTarget(attributeValue(relation.open.raw, "Target") ?? "") !==
      binding.sheetPath
  ) {
    throw new TemplateCompilerError(
      "worksheet_relationship_mismatch",
      "Связь выбранного листа не совпадает с сохранённой структурой XLSX."
    );
  }
  const contentTypes = decodeXml(
    packageEntry(entries, CONTENT_TYPES_PART).content
  ).text;
  validateRootNamespace(
    contentTypes,
    "Types",
    CONTENT_TYPES_NAMESPACE,
    "Типы частей XLSX"
  );
  const expectedPartName = `/${binding.sheetPath}`;
  const overrides = findElements(contentTypes, "Override").filter(
    ({ open }) => attributeValue(open.raw, "PartName") === expectedPartName
  );
  if (
    overrides.length !== 1 ||
    attributeValue(overrides[0]?.open.raw ?? "", "ContentType") !==
      "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
  ) {
    throw new TemplateCompilerError(
      "worksheet_content_type_mismatch",
      "Тип выбранного листа не соответствует безопасному XLSX."
    );
  }
}

function normalizedCompileFields(
  fields: readonly CompileXlsxRepeatField[],
  binding: XlsxRepeatRowBinding
): Array<CompileXlsxRepeatField & { fieldBinding: XlsxCellBinding }> {
  if (fields.length < 1 || fields.length > MAX_FIELDS) {
    throw new TemplateCompilerError(
      "invalid_repeat_field_count",
      `Повторяемая строка должна содержать от 1 до ${MAX_FIELDS} полей.`
    );
  }
  const start = parseCellAddress(binding.startAddress);
  const end = parseCellAddress(binding.endAddress);
  const result = fields.map((field) => {
    if (
      field.technicalBinding.kind !== "xlsx.defined-name" ||
      field.fieldBinding.kind !== "xlsx.cell" ||
      field.fieldBinding.sheetName !== binding.sheetName ||
      field.fieldBinding.sheetPath !== binding.sheetPath
    ) {
      throw new TemplateCompilerError(
        "repeat_field_outside_row",
        "Все поля повторяемого диапазона должны быть ячейками одного листа XLSX."
      );
    }
    const address = parseCellAddress(field.fieldBinding.address);
    if (
      address.row !== binding.rowNumber ||
      address.column < start.column ||
      address.column > end.column
    ) {
      throw new TemplateCompilerError(
        "repeat_field_outside_row",
        "Одно из полей находится вне выбранного повторяемого диапазона XLSX."
      );
    }
    return { ...field, fieldBinding: field.fieldBinding };
  });
  const addresses = result.map((field) => field.fieldBinding.address);
  if (new Set(addresses).size !== addresses.length) {
    throw new TemplateCompilerError(
      "duplicate_repeat_field",
      "Два поля повторяемой строки используют одну ячейку XLSX."
    );
  }
  return result;
}

function validateRepeatTemplate(
  entries: readonly OoxmlPackageEntry[],
  binding: XlsxRepeatRowBinding,
  fields: readonly CompileXlsxRepeatField[]
): WorksheetModel {
  validatePackageSecurity(entries);
  validateWorksheetRelationship(entries, binding);
  const normalized = normalizedCompileFields(fields, binding);
  const model = worksheetModel(entries, binding);
  const sample = model.rows.find((row) => row.rowNumber === binding.rowNumber);
  if (sample === undefined || sample.hidden) {
    throw new TemplateCompilerError(
      "repeat_row_not_found",
      "Выбранная строка XLSX не найдена или скрыта."
    );
  }
  const start = parseCellAddress(binding.startAddress);
  const end = parseCellAddress(binding.endAddress);
  if (
    !sample.cells.some((cell) => cell.address.address === start.address) ||
    !sample.cells.some((cell) => cell.address.address === end.address)
  ) {
    throw new TemplateCompilerError(
      "repeat_range_not_found",
      "Границы повторяемого диапазона отсутствуют в выбранной строке XLSX."
    );
  }
  for (const field of normalized) {
    const cell = sample.cells.find(
      (candidate) => candidate.address.address === field.fieldBinding.address
    );
    if (cell === undefined) {
      throw new TemplateCompilerError(
        "repeat_field_not_found",
        `Поле в ячейке «${field.fieldBinding.address}» отсутствует в строке-образце.`
      );
    }
    if (cell.formula !== null) {
      throw new TemplateCompilerError(
        "formula_field_not_supported",
        `Поле в ячейке «${field.fieldBinding.address}» нельзя записывать поверх формулы.`
      );
    }
  }
  for (const merge of model.merges) {
    const crossesRow =
      merge.start.row <= binding.rowNumber && merge.end.row >= binding.rowNumber;
    if (!crossesRow) continue;
    if (merge.start.row !== binding.rowNumber || merge.end.row !== binding.rowNumber) {
      throw new TemplateCompilerError(
        "merged_cells_cross_repeat_boundary",
        "Объединение ячеек пересекает границу повторяемой строки XLSX."
      );
    }
    const inside =
      merge.start.column >= start.column && merge.end.column <= end.column;
    const outside =
      merge.end.column < start.column || merge.start.column > end.column;
    if (!inside && !outside) {
      throw new TemplateCompilerError(
        "merged_cells_cross_repeat_boundary",
        "Объединение ячеек пересекает левую или правую границу повторяемого диапазона."
      );
    }
    for (const field of normalized) {
      const address = parseCellAddress(field.fieldBinding.address);
      if (
        address.column >= merge.start.column &&
        address.column <= merge.end.column &&
        address.column !== merge.start.column
      ) {
        throw new TemplateCompilerError(
          "field_in_merged_cell",
          "Поле в объединённой области должно находиться в её левой верхней ячейке."
        );
      }
    }
  }
  return model;
}

interface DefinedName {
  range: ElementRange;
  name: string;
  target: string;
}

function definedNames(xml: string): DefinedName[] {
  return findElements(xml, "definedName").map((range) => ({
    range,
    name: attributeValue(range.open.raw, "name") ?? "",
    target: elementText(xml, range)
  }));
}

function validateTechnicalDefinedNames(
  workbookXml: string,
  binding: XlsxRepeatRowBinding,
  fields: readonly CompileXlsxRepeatField[],
  expectedRepeat: XlsxRepeatTechnicalBinding | null
): void {
  const names = definedNames(workbookXml);
  const folded = names.map((item) => item.name.toUpperCase());
  if (new Set(folded).size !== folded.length) {
    throw new TemplateCompilerError(
      "duplicate_defined_name",
      "Книга содержит повторяющиеся именованные диапазоны без учёта регистра."
    );
  }
  for (const field of normalizedCompileFields(fields, binding)) {
    const found = names.filter(
      (item) =>
        item.name.toUpperCase() === field.technicalBinding.identifier.toUpperCase()
    );
    const expected = `${quoteSheetName(binding.sheetName)}!${absoluteAddress(
      parseCellAddress(field.fieldBinding.address)
    )}`;
    if (found.length !== 1 || found[0]?.target !== expected) {
      throw new TemplateCompilerError(
        "technical_binding_mismatch",
        "Именованная привязка поля XLSX не совпадает с выбранной ячейкой."
      );
    }
  }
  const repeatMatches = names.filter(
    (item) =>
      expectedRepeat !== null &&
      item.name.toUpperCase() === expectedRepeat.identifier.toUpperCase()
  );
  if (
    expectedRepeat === null &&
    names.some((item) =>
      item.name.toUpperCase().startsWith("_DOCOMATOR_REPEAT_")
    )
  ) {
    throw new TemplateCompilerError(
      "repeat_binding_already_exists",
      "Книга уже содержит техническую привязку повторяемой строки."
    );
  }
  if (
    expectedRepeat !== null &&
    (repeatMatches.length !== 1 || repeatMatches[0]?.target !== expectedRepeat.target)
  ) {
    throw new TemplateCompilerError(
      "compiled_repeat_binding_not_found",
      "После сборки не найдена точная привязка повторяемого диапазона XLSX."
    );
  }
  const technicalNames = new Set([
    ...fields.map((field) => field.technicalBinding.identifier.toUpperCase()),
    ...(expectedRepeat === null ? [] : [expectedRepeat.identifier.toUpperCase()])
  ]);
  if (
    names.some(
      (item) => !technicalNames.has(item.name.toUpperCase())
    )
  ) {
    throw new TemplateCompilerError(
      "affected_defined_name_not_supported",
      "Книга содержит пользовательский именованный диапазон или область печати. Для безопасного повтора удалите дополнительные имена из книги."
    );
  }
}

function addDefinedName(
  workbookXml: string,
  technical: XlsxRepeatTechnicalBinding
): string {
  const workbook = firstElement(workbookXml, "workbook");
  const prefix = tagPrefix(workbook.open.name);
  const node = `<${prefix}definedName name="${xmlAttribute(
    technical.identifier
  )}">${xmlText(technical.target)}</${prefix}definedName>`;
  const containers = findElements(workbookXml, "definedNames");
  const container = containers[0];
  if (containers.length > 1) invalidXml();
  if (container !== undefined) {
    if (container.open.selfClosing) {
      return (
        workbookXml.slice(0, container.open.start) +
        `<${prefix}definedNames>${node}</${prefix}definedNames>` +
        workbookXml.slice(container.open.end)
      );
    }
    return (
      workbookXml.slice(0, container.close.start) +
      node +
      workbookXml.slice(container.close.start)
    );
  }
  const sheets = firstElement(workbookXml, "sheets");
  return (
    workbookXml.slice(0, sheets.close.end) +
    `<${prefix}definedNames>${node}</${prefix}definedNames>` +
    workbookXml.slice(sheets.close.end)
  );
}

export async function compileXlsxRepeatRow(
  input: CompileXlsxRepeatRowInput
): Promise<CompileXlsxRepeatRowResult> {
  const compiled = Buffer.from(input.compiled);
  const binding = parseXlsxRepeatRowBinding(input.binding);
  const entries = await readOoxmlPackage(compiled);
  validateRepeatTemplate(entries, binding, input.fields);
  const workbookEntry = packageEntry(entries, WORKBOOK_PART);
  const decoded = decodeXml(workbookEntry.content);
  validateTechnicalDefinedNames(decoded.text, binding, input.fields, null);
  const technicalBinding: XlsxRepeatTechnicalBinding = {
    kind: "xlsx.repeat-defined-name",
    identifier: repeatIdentifier(binding),
    part: WORKBOOK_PART,
    target: repeatTarget(binding)
  };
  const updatedWorkbook = addDefinedName(decoded.text, technicalBinding);
  let updatedEntries = replaceEntry(
    entries,
    WORKBOOK_PART,
    encodeXml(decoded, updatedWorkbook)
  );
  const output = writeOoxmlPackage(updatedEntries);
  updatedEntries = await readOoxmlPackage(output);
  validateRepeatTemplate(updatedEntries, binding, input.fields);
  const verifiedWorkbook = decodeXml(
    packageEntry(updatedEntries, WORKBOOK_PART).content
  ).text;
  validateTechnicalDefinedNames(
    verifiedWorkbook,
    binding,
    input.fields,
    technicalBinding
  );
  return {
    output,
    inputSha256: sha256(compiled),
    outputSha256: sha256(output),
    modifiedPart: WORKBOOK_PART,
    binding,
    technicalBinding,
    verification: {
      found: true,
      fieldCount: input.fields.length,
      message: `После сборки проверены повторяемый диапазон XLSX и поля: ${input.fields.length}.`
    }
  };
}

function repeatValueMissing(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

function normalizedRenderFields(
  fields: readonly RenderXlsxRepeatField[],
  binding: XlsxRepeatRowBinding
): NormalizedRepeatField[] {
  const compiled = normalizedCompileFields(
    fields.map((field) => ({
      fieldId: field.fieldId,
      technicalBinding: field.technicalBinding,
      fieldBinding: field.fieldBinding
    })),
    binding
  );
  const byId = new Map(compiled.map((field) => [field.fieldId, field]));
  const normalized = fields.map((field) => {
    const validated = byId.get(field.fieldId);
    if (validated === undefined) {
      throw new TemplateCompilerError(
        "repeat_field_mismatch",
        "Поле повторяемой строки не прошло проверку привязки."
      );
    }
    return {
      fieldId: field.fieldId,
      fieldKey: field.fieldKey,
      required: field.required,
      technicalBinding: field.technicalBinding,
      fieldBinding: validated.fieldBinding,
      valueType: field.valueType,
      ...(field.formatter === undefined ? {} : { formatter: field.formatter }),
      column: parseCellAddress(validated.fieldBinding.address).column
    };
  });
  const ids = normalized.map((field) => field.fieldId);
  const keys = normalized.map((field) => field.fieldKey);
  if (new Set(ids).size !== ids.length || new Set(keys).size !== keys.length) {
    throw new TemplateCompilerError(
      "duplicate_repeat_field",
      "Повторяемая строка содержит повторяющееся поле."
    );
  }
  return normalized;
}

function normalizedMemberValues(
  fields: readonly NormalizedRepeatField[],
  members: readonly RenderXlsxRepeatMember[]
): NormalizedScalarValue[][] {
  if (members.length < 1 || members.length > MAX_MEMBERS) {
    throw new TemplateCompilerError(
      "invalid_repeat_member_count",
      `Для повторяемой строки требуется от 1 до ${MAX_MEMBERS} участников.`
    );
  }
  const memberIds = members.map((member) => member.memberId);
  if (
    memberIds.some(
      (id) =>
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > 160 ||
        /[\u0000-\u001f\u007f]/u.test(id)
    ) ||
    new Set(memberIds).size !== memberIds.length
  ) {
    throw new TemplateCompilerError(
      "invalid_repeat_members",
      "Состав повторяемой строки содержит недопустимые или повторяющиеся идентификаторы."
    );
  }
  return members.map((member) => {
    if (member.values.length !== fields.length) {
      throw new TemplateCompilerError(
        "repeat_member_value_count_mismatch",
        "Число значений участника не совпадает с числом полей повторяемой строки."
      );
    }
    return fields.map((field, index) => {
      const value = member.values[index];
      const missing = repeatValueMissing(value);
      if (missing && field.required) {
        throw new TemplateCompilerError(
          "repeat_required_value_missing",
          `Не заполнено обязательное поле «${field.fieldKey}».`
        );
      }
      return missing
        ? {
            display: "",
            xlsxMode: "inline-string",
            xlsxValue: ""
          }
        : normalizeScalarValueForRendering(
            field.valueType,
            value,
            field.formatter
          );
    });
  });
}

function cellElement(cellXml: string): ElementRange {
  const tags = scanXmlTags(cellXml);
  const index = tags.findIndex(
    (tag) => !tag.closing && tag.localName === "c"
  );
  if (index < 0) invalidXml();
  const closeIndex = matchingCloseIndex(tags, index);
  const open = tags[index];
  const close = tags[closeIndex];
  if (open === undefined || close === undefined) invalidXml();
  return { openIndex: index, closeIndex, open, close };
}

function containerOpening(opening: string): string {
  return opening.replace(/\/>$/u, ">");
}

function renderCell(
  cell: WorksheetCell,
  destinationRow: number,
  normalized: NormalizedScalarValue | null,
  sourceRow: number,
  area: SafeXlsxFormulaArea
): { xml: string; formula: ExpectedFormula | null } {
  const range = cellElement(cell.xml);
  const openingSource = cell.xml.slice(range.open.start, range.open.end);
  const address = `${cell.address.columnName}${destinationRow}`;
  let opening = setAttribute(openingSource, "r", address);
  const closing = `</${range.open.name}>`;
  if (normalized !== null) {
    opening = containerOpening(
      setCellType(
        opening,
        normalized.xlsxMode === "inline-string"
          ? "inlineStr"
          : normalized.xlsxMode === "boolean"
            ? "b"
            : null
      )
    );
    const prefix = tagPrefix(range.open.name);
    const content =
      normalized.xlsxMode === "inline-string"
        ? `<${prefix}is><${prefix}t xml:space="preserve">${xmlText(
            normalized.xlsxValue
          )}</${prefix}t></${prefix}is>`
        : `<${prefix}v>${xmlText(normalized.xlsxValue)}</${prefix}v>`;
    return { xml: `${opening}${content}${closing}`, formula: null };
  }
  if (cell.formula !== null) {
    const formula = translateSafeXlsxFormula(
      cell.formula,
      sourceRow,
      destinationRow,
      area
    );
    opening = containerOpening(opening);
    const prefix = tagPrefix(range.open.name);
    return {
      xml: `${opening}<${prefix}f>${xmlText(formula)}</${prefix}f>${closing}`,
      formula: { address, formula }
    };
  }
  if (range.open.selfClosing) return { xml: opening, formula: null };
  return {
    xml:
      opening +
      cell.xml.slice(range.open.end, range.close.start) +
      cell.xml.slice(range.close.start, range.close.end),
    formula: null
  };
}

function renderSampleRow(
  sample: WorksheetRow,
  binding: XlsxRepeatRowBinding,
  destinationRow: number,
  fields: readonly NormalizedRepeatField[],
  values: readonly NormalizedScalarValue[],
  keepOutsideRange: boolean
): { xml: string; formulas: ExpectedFormula[] } {
  const start = parseCellAddress(binding.startAddress).column;
  const end = parseCellAddress(binding.endAddress).column;
  const byColumn = new Map(
    fields.map((field, index) => [field.column, values[index] ?? null])
  );
  const cells = sample.cells.filter(
    (cell) =>
      keepOutsideRange ||
      (cell.address.column >= start && cell.address.column <= end)
  );
  const rendered = cells.map((cell) =>
    renderCell(
      cell,
      destinationRow,
      byColumn.get(cell.address.column) ?? null,
      binding.rowNumber,
      safeFormulaArea(binding)
    )
  );
  const opening = setAttribute(sample.opening, "r", String(destinationRow));
  return {
    xml: `${opening}${rendered.map((cell) => cell.xml).join("")}${sample.closing}`,
    formulas: rendered.flatMap((cell) =>
      cell.formula === null ? [] : [cell.formula]
    )
  };
}

function shiftTrailingRow(
  row: WorksheetRow,
  delta: number,
  binding: XlsxRepeatRowBinding
): string {
  const destinationRow = row.rowNumber + delta;
  if (destinationRow > MAX_ROW) {
    throw new TemplateCompilerError(
      "repeat_row_overflow",
      "После повтора строки данные выходят за последний ряд XLSX."
    );
  }
  const cells = row.cells.map((cell) =>
    renderCell(
      cell,
      destinationRow,
      null,
      row.rowNumber,
      safeFormulaArea(binding)
    )
  );
  if (cells.some((cell) => cell.formula !== null)) {
    throw new TemplateCompilerError(
      "formula_below_repeat_not_supported",
      "Формулы ниже повторяемой строки пока не поддерживаются."
    );
  }
  return `${setAttribute(row.opening, "r", String(destinationRow))}${cells
    .map((cell) => cell.xml)
    .join("")}${row.closing}`;
}

function renderedWorksheetRows(
  model: WorksheetModel,
  binding: XlsxRepeatRowBinding,
  fields: readonly NormalizedRepeatField[],
  values: readonly NormalizedScalarValue[][]
): {
  xml: string;
  formulas: ExpectedFormula[];
  outputCells: CellAddress[];
} {
  const sample = model.rows.find((row) => row.rowNumber === binding.rowNumber);
  if (sample === undefined) invalidXml();
  const delta = values.length - 1;
  const formulas: ExpectedFormula[] = [];
  const outputCells: CellAddress[] = [];
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const repeatedRows = values.map((memberValues, index) => {
    const destinationRow = binding.rowNumber + index;
    if (destinationRow > MAX_ROW) {
      throw new TemplateCompilerError(
        "repeat_row_overflow",
        "Повторяемые строки выходят за пределы XLSX."
      );
    }
    const rendered = renderSampleRow(
      sample,
      binding,
      destinationRow,
      fields,
      memberValues,
      index === 0
    );
    formulas.push(...rendered.formulas);
    const start = parseCellAddress(binding.startAddress).column;
    const end = parseCellAddress(binding.endAddress).column;
    for (const cell of sample.cells) {
      if (
        index === 0 ||
        (cell.address.column >= start && cell.address.column <= end)
      ) {
        outputCells.push(
          parseCellAddress(`${cell.address.columnName}${destinationRow}`)
        );
      }
    }
    return rendered.xml;
  });
  replacements.push({
    start: sample.start,
    end: sample.end,
    value: repeatedRows.join("")
  });
  for (const row of model.rows) {
    if (row.rowNumber < binding.rowNumber) {
      outputCells.push(...row.cells.map((cell) => cell.address));
    } else if (row.rowNumber > binding.rowNumber) {
      replacements.push({
        start: row.start,
        end: row.end,
        value: shiftTrailingRow(row, delta, binding)
      });
      outputCells.push(
        ...row.cells.map((cell) =>
          parseCellAddress(`${cell.address.columnName}${cell.address.row + delta}`)
        )
      );
    }
  }
  return {
    xml: applyReplacements(model.xml, replacements),
    formulas,
    outputCells
  };
}

function rangeRef(range: CellRange): string {
  return `${range.start.address}:${range.end.address}`;
}

function shiftedRange(range: CellRange, rowDelta: number): CellRange {
  return {
    start: parseCellAddress(
      `${range.start.columnName}${range.start.row + rowDelta}`
    ),
    end: parseCellAddress(`${range.end.columnName}${range.end.row + rowDelta}`)
  };
}

function expectedMerges(
  model: WorksheetModel,
  binding: XlsxRepeatRowBinding,
  memberCount: number
): CellRange[] {
  const startColumn = parseCellAddress(binding.startAddress).column;
  const endColumn = parseCellAddress(binding.endAddress).column;
  const delta = memberCount - 1;
  const result: CellRange[] = [];
  for (const merge of model.merges) {
    if (merge.end.row < binding.rowNumber) {
      result.push(merge);
    } else if (merge.start.row > binding.rowNumber) {
      result.push(shiftedRange(merge, delta));
    } else {
      const inside =
        merge.start.column >= startColumn && merge.end.column <= endColumn;
      if (inside) {
        for (let index = 0; index < memberCount; index += 1) {
          result.push(shiftedRange(merge, index));
        }
      } else {
        result.push(merge);
      }
    }
  }
  return result;
}

function updateMerges(xml: string, ranges: readonly CellRange[]): string {
  const containers = findElements(xml, "mergeCells");
  const container = containers[0];
  if (container === undefined) {
    if (ranges.length === 0) return xml;
    throw new TemplateCompilerError(
      "invalid_merged_cells",
      "После заполнения не найден контейнер объединённых ячеек."
    );
  }
  if (ranges.length === 0) {
    return xml.slice(0, container.open.start) + xml.slice(container.close.end);
  }
  const prefix = tagPrefix(container.open.name);
  const opening = containerOpening(
    setAttribute(
      xml.slice(container.open.start, container.open.end),
      "count",
      String(ranges.length)
    )
  );
  const content = ranges
    .map(
      (range) =>
        `<${prefix}mergeCell ref="${xmlAttribute(rangeRef(range))}"/>`
    )
    .join("");
  return (
    xml.slice(0, container.open.start) +
    opening +
    content +
    `</${container.open.name}>` +
    xml.slice(container.close.end)
  );
}

function dimensionReference(cells: readonly CellAddress[]): string {
  if (cells.length === 0) return "A1";
  const minColumn = Math.min(...cells.map((cell) => cell.column));
  const maxColumn = Math.max(...cells.map((cell) => cell.column));
  const minRow = Math.min(...cells.map((cell) => cell.row));
  const maxRow = Math.max(...cells.map((cell) => cell.row));
  const start = `${columnName(minColumn)}${minRow}`;
  const end = `${columnName(maxColumn)}${maxRow}`;
  return start === end ? start : `${start}:${end}`;
}

function updateDimension(xml: string, reference: string): string {
  const dimensions = findElements(xml, "dimension");
  if (dimensions.length > 1) invalidXml();
  const dimension = dimensions[0];
  if (dimension !== undefined) {
    const opening = setAttribute(
      xml.slice(dimension.open.start, dimension.open.end),
      "ref",
      reference
    );
    return (
      xml.slice(0, dimension.open.start) +
      opening +
      xml.slice(dimension.open.end)
    );
  }
  const worksheet = firstElement(xml, "worksheet");
  const prefix = tagPrefix(worksheet.open.name);
  const sheetProperties = findElements(xml, "sheetPr")[0];
  const insertAt = sheetProperties?.close.end ?? worksheet.open.end;
  return (
    xml.slice(0, insertAt) +
    `<${prefix}dimension ref="${xmlAttribute(reference)}"/>` +
    xml.slice(insertAt)
  );
}

function removeElements(
  xml: string,
  wanted: string,
  predicate: (range: ElementRange) => boolean
): string {
  return applyReplacements(
    xml,
    findElements(xml, wanted)
      .filter(predicate)
      .map((range) => ({
        start: range.open.start,
        end: range.close.end,
        value: ""
      }))
  );
}

function cleanWorkbookXml(xml: string): string {
  let updated = removeElements(xml, "definedName", (range) =>
    (attributeValue(range.open.raw, "name") ?? "")
      .toUpperCase()
      .startsWith("_DOCOMATOR_")
  );
  const calcProperties = findElements(updated, "calcPr");
  if (calcProperties.length > 1) invalidXml();
  const existing = calcProperties[0];
  if (existing !== undefined) {
    let opening = updated.slice(existing.open.start, existing.open.end);
    opening = setAttribute(opening, "calcMode", "auto");
    opening = setAttribute(opening, "fullCalcOnLoad", "1");
    opening = setAttribute(opening, "forceFullCalc", "1");
    updated =
      updated.slice(0, existing.open.start) +
      opening +
      updated.slice(existing.open.end);
    return updated;
  }
  const workbook = firstElement(updated, "workbook");
  const prefix = tagPrefix(workbook.open.name);
  const extension = findElements(updated, "extLst")[0];
  const insertAt = extension?.open.start ?? workbook.close.start;
  return (
    updated.slice(0, insertAt) +
    `<${prefix}calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>` +
    updated.slice(insertAt)
  );
}

function removeCalcChain(entries: readonly OoxmlPackageEntry[]): {
  entries: OoxmlPackageEntry[];
  modifiedParts: string[];
} {
  let result = entries.filter((entry) => entry.name !== CALC_CHAIN_PART);
  const modifiedParts: string[] = [];
  const relationshipsEntry = result.find(
    (entry) => entry.name === WORKBOOK_RELATIONSHIPS_PART
  );
  if (relationshipsEntry !== undefined) {
    const decoded = decodeXml(relationshipsEntry.content);
    const updated = removeElements(
      decoded.text,
      "Relationship",
      (range) =>
        (attributeValue(range.open.raw, "Type") ?? "").endsWith(
          "/calcChain"
        ) ||
        (attributeValue(range.open.raw, "Target") ?? "").endsWith(
          "calcChain.xml"
        )
    );
    if (updated !== decoded.text) {
      result = replaceEntry(
        result,
        WORKBOOK_RELATIONSHIPS_PART,
        encodeXml(decoded, updated)
      );
      modifiedParts.push(WORKBOOK_RELATIONSHIPS_PART);
    }
  }
  const contentTypesEntry = result.find(
    (entry) => entry.name === CONTENT_TYPES_PART
  );
  if (contentTypesEntry !== undefined) {
    const decoded = decodeXml(contentTypesEntry.content);
    const updated = removeElements(
      decoded.text,
      "Override",
      (range) =>
        attributeValue(range.open.raw, "PartName") === "/xl/calcChain.xml"
    );
    if (updated !== decoded.text) {
      result = replaceEntry(
        result,
        CONTENT_TYPES_PART,
        encodeXml(decoded, updated)
      );
      modifiedParts.push(CONTENT_TYPES_PART);
    }
  }
  if (entries.some((entry) => entry.name === CALC_CHAIN_PART)) {
    modifiedParts.push(CALC_CHAIN_PART);
  }
  return { entries: result, modifiedParts };
}

function inlineCellText(cell: WorksheetCell): string {
  return directTextValues(cell.xml, "t").join("");
}

function readCellDisplay(
  cell: WorksheetCell,
  field: NormalizedRepeatField
): string {
  if (cell.type === "inlineStr") return inlineCellText(cell);
  const raw = cellRawValue(cell.xml);
  if (cell.type === "b") {
    return formatScalarDisplay(field.valueType, raw === "1", field.formatter);
  }
  if (
    (cell.type === "n" || cell.type === "") &&
    (field.valueType === "number" || field.valueType === "integer")
  ) {
    return formatScalarDisplay(field.valueType, raw, field.formatter);
  }
  return raw;
}

function sortedRangeRefs(ranges: readonly CellRange[]): string[] {
  return ranges.map(rangeRef).sort((left, right) => left.localeCompare(right, "en"));
}

function verifyUntouchedParts(
  before: readonly OoxmlPackageEntry[],
  after: readonly OoxmlPackageEntry[],
  modified: ReadonlySet<string>
): void {
  const afterByName = new Map(after.map((entry) => [entry.name, entry]));
  for (const entry of before) {
    if (modified.has(entry.name)) continue;
    const current = afterByName.get(entry.name);
    if (current === undefined || !current.content.equals(entry.content)) {
      throw new TemplateCompilerError(
        "untouched_part_changed",
        `При заполнении неожиданно изменилась часть «${entry.name}».`
      );
    }
  }
}

function verifyRenderedWorkbook(
  before: readonly OoxmlPackageEntry[],
  after: readonly OoxmlPackageEntry[],
  binding: XlsxRepeatRowBinding,
  technical: XlsxRepeatTechnicalBinding,
  fields: readonly NormalizedRepeatField[],
  values: readonly NormalizedScalarValue[][],
  expectedFormulas: readonly ExpectedFormula[],
  expectedMergeRanges: readonly CellRange[],
  expectedDimension: string,
  sourceModel: WorksheetModel,
  modifiedParts: ReadonlySet<string>
): void {
  validatePackageSecurity(after);
  validateWorksheetRelationship(after, binding);
  if (after.some((entry) => entry.name === CALC_CHAIN_PART)) {
    throw new TemplateCompilerError(
      "calc_chain_not_removed",
      "После структурного заполнения осталась устаревшая цепочка расчёта."
    );
  }
  const workbook = decodeXml(packageEntry(after, WORKBOOK_PART).content).text;
  if (
    definedNames(workbook).some(
      (item) =>
        item.name.toUpperCase().startsWith("_DOCOMATOR_") ||
        item.name.toUpperCase() === technical.identifier.toUpperCase()
    )
  ) {
    throw new TemplateCompilerError(
      "technical_marker_not_removed",
      "В готовой книге осталась техническая именованная привязка."
    );
  }
  const lastRepeatedRow = binding.rowNumber + values.length - 1;
  const model = worksheetModel(
    after,
    binding,
    binding.rowNumber,
    lastRepeatedRow
  );
  const sample = sourceModel.rows.find(
    (row) => row.rowNumber === binding.rowNumber
  );
  if (sample === undefined) invalidXml();
  const expectedRowProperties = removeAttribute(sample.opening, "r");
  for (let memberIndex = 0; memberIndex < values.length; memberIndex += 1) {
    const rowNumber = binding.rowNumber + memberIndex;
    const row = model.rows.find((candidate) => candidate.rowNumber === rowNumber);
    if (row === undefined || removeAttribute(row.opening, "r") !== expectedRowProperties) {
      throw new TemplateCompilerError(
        "repeat_row_property_mismatch",
        `Строка результата ${rowNumber} потеряла свойства строки-образца.`
      );
    }
    for (const [fieldIndex, field] of fields.entries()) {
      const address = `${columnName(field.column)}${rowNumber}`;
      const cell = row.cells.find(
        (candidate) => candidate.address.address === address
      );
      const sourceCell = sample.cells.find(
        (candidate) => candidate.address.column === field.column
      );
      if (cell === undefined || sourceCell === undefined) {
        throw new TemplateCompilerError(
          "repeat_field_count_mismatch",
          `В строке ${rowNumber} отсутствует одно из полей.`
        );
      }
      if (cell.styleIndex !== sourceCell.styleIndex) {
        throw new TemplateCompilerError(
          "repeat_style_mismatch",
          `Ячейка «${address}» потеряла исходный стиль.`
        );
      }
      const actual = readCellDisplay(cell, field);
      const expected = values[memberIndex]?.[fieldIndex]?.display;
      if (actual !== expected) {
        throw new TemplateCompilerError(
          "repeat_value_mismatch",
          `После заполнения значение ячейки «${address}» не совпало с ожидаемым.`
        );
      }
    }
  }
  const actualFormulas = model.formulas
    .filter(
      (formula) =>
        formula.row >= binding.rowNumber && formula.row <= lastRepeatedRow
    )
    .map((formula) => ({ address: formula.address, formula: formula.formula }))
    .sort((left, right) => left.address.localeCompare(right.address, "en"));
  const wantedFormulas = [...expectedFormulas].sort((left, right) =>
    left.address.localeCompare(right.address, "en")
  );
  if (JSON.stringify(actualFormulas) !== JSON.stringify(wantedFormulas)) {
    throw new TemplateCompilerError(
      "repeat_formula_mismatch",
      "Формулы клонированных строк не совпали с ожидаемым безопасным преобразованием."
    );
  }
  if (
    JSON.stringify(sortedRangeRefs(model.merges)) !==
    JSON.stringify(sortedRangeRefs(expectedMergeRanges))
  ) {
    throw new TemplateCompilerError(
      "repeat_merge_mismatch",
      "Объединённые ячейки после заполнения не совпали с ожидаемой структурой."
    );
  }
  const sheetXml = decodeXml(packageEntry(after, binding.sheetPath).content).text;
  const dimensions = findElements(sheetXml, "dimension");
  if (
    dimensions.length !== 1 ||
    attributeValue(dimensions[0]?.open.raw ?? "", "ref") !== expectedDimension
  ) {
    throw new TemplateCompilerError(
      "repeat_dimension_mismatch",
      "Размер заполненного листа не совпал с фактическими ячейками."
    );
  }
  verifyUntouchedParts(before, after, modifiedParts);
}

export async function renderXlsxRepeatRows(
  input: RenderXlsxRepeatRowsInput
): Promise<RenderXlsxRepeatRowsResult> {
  const compiled = Buffer.from(input.compiled);
  const contract = parseXlsxRepeatRowContract({
    version: 1,
    kind: "xlsx.repeat-row-contract",
    binding: input.binding,
    technicalBinding: input.technicalBinding
  });
  const fields = normalizedRenderFields(input.fields, contract.binding);
  const values = normalizedMemberValues(fields, input.members);
  const entries = await readOoxmlPackage(compiled);
  const compileFields: CompileXlsxRepeatField[] = fields.map((field) => ({
    fieldId: field.fieldId,
    technicalBinding: field.technicalBinding,
    fieldBinding: field.fieldBinding
  }));
  const sourceModel = validateRepeatTemplate(entries, contract.binding, compileFields);
  const workbookDecoded = decodeXml(packageEntry(entries, WORKBOOK_PART).content);
  validateTechnicalDefinedNames(
    workbookDecoded.text,
    contract.binding,
    compileFields,
    contract.technicalBinding
  );
  const renderedRows = renderedWorksheetRows(
    sourceModel,
    contract.binding,
    fields,
    values
  );
  const merges = expectedMerges(
    sourceModel,
    contract.binding,
    values.length
  );
  let worksheetXml = updateMerges(renderedRows.xml, merges);
  const dimension = dimensionReference([
    ...renderedRows.outputCells,
    ...merges.flatMap((range) => [range.start, range.end])
  ]);
  worksheetXml = updateDimension(worksheetXml, dimension);
  if (Buffer.byteLength(worksheetXml, "utf8") > MAX_WORKSHEET_BYTES) {
    throw new TemplateCompilerError(
      "repeat_output_too_large",
      "Заполненный лист превышает безопасный предел размера."
    );
  }
  const worksheetDecoded = decodeXml(
    packageEntry(entries, contract.binding.sheetPath).content
  );
  let updatedEntries = replaceEntry(
    entries,
    contract.binding.sheetPath,
    encodeXml(worksheetDecoded, worksheetXml)
  );
  const workbookXml = cleanWorkbookXml(workbookDecoded.text);
  updatedEntries = replaceEntry(
    updatedEntries,
    WORKBOOK_PART,
    encodeXml(workbookDecoded, workbookXml)
  );
  const calcChain = removeCalcChain(updatedEntries);
  updatedEntries = calcChain.entries;
  const modifiedParts = new Set<string>([
    contract.binding.sheetPath,
    WORKBOOK_PART,
    ...calcChain.modifiedParts
  ]);
  const output = writeOoxmlPackage(updatedEntries);
  const verifiedEntries = await readOoxmlPackage(output);
  verifyRenderedWorkbook(
    entries,
    verifiedEntries,
    contract.binding,
    contract.technicalBinding,
    fields,
    values,
    renderedRows.formulas,
    merges,
    dimension,
    sourceModel,
    modifiedParts
  );
  return {
    output,
    inputSha256: sha256(compiled),
    outputSha256: sha256(output),
    modifiedParts: [...modifiedParts].sort(),
    rowCount: values.length,
    fieldCount: fields.length,
    verification: {
      matched: true,
      checkedValues: values.length * fields.length,
      checkedFormulas: renderedRows.formulas.length,
      message: `Повторно считаны значения XLSX: ${values.length * fields.length}; проверены формулы: ${renderedRows.formulas.length}.`
    }
  };
}
