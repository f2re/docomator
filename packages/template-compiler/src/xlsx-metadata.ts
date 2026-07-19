import { TemplateCompilerError } from "./errors.js";
import {
  packageEntry,
  type OoxmlPackageEntry
} from "./ooxml-package.js";

export const XLSX_METADATA_SHEET_NAME = "_AI_META";
export const XLSX_METADATA_PART = "xl/worksheets/_ai_meta.xml";
export const XLSX_METADATA_RELATIONSHIPS_PART =
  "xl/worksheets/_rels/_ai_meta.xml.rels";
export const XLSX_METADATA_VERSION = 1 as const;

const WORKBOOK_PART = "xl/workbook.xml";
const WORKBOOK_RELATIONSHIPS_PART = "xl/_rels/workbook.xml.rels";
const CONTENT_TYPES_PART = "[Content_Types].xml";
const METADATA_RELATIONSHIP_ID = "rIdDocomatorMeta";
const METADATA_RELATIONSHIP_TARGET = "worksheets/_ai_meta.xml";
const METADATA_PART_NAME = `/${XLSX_METADATA_PART}`;
const METADATA_MARKER = "DOCOMATOR_XLSX_METADATA";
const SPREADSHEET_NAMESPACE =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const OFFICE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const WORKSHEET_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const WORKSHEET_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";
const MAX_METADATA_RECORDS = 101;
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

export interface XlsxMetadataRecord {
  kind: "field" | "repeat";
  identifier: string;
  part: string;
  target: string;
}

export interface VerifyXlsxMetadataOptions {
  expectedRecords?: readonly XlsxMetadataRecord[];
  exactExpectedRecords?: boolean;
  definedNames?: "present" | "absent" | "ignore";
}

export interface UpsertXlsxMetadataResult {
  entries: OoxmlPackageEntry[];
  modifiedParts: string[];
  records: XlsxMetadataRecord[];
}

interface XmlTag {
  start: number;
  end: number;
  name: string;
  localName: string;
  namespaceUri: string | null;
  attributes: ReadonlyMap<string, string>;
  attributeNamespaces: ReadonlyMap<string, string | null>;
  closing: boolean;
  selfClosing: boolean;
  raw: string;
}

interface ElementRange {
  open: XmlTag;
  close: XmlTag;
  openIndex: number;
  closeIndex: number;
}

interface DecodedXml {
  text: string;
  encoding: "utf8" | "utf16le" | "utf16be";
  bom: boolean;
}

interface WorkbookModel {
  decoded: DecodedXml;
  root: ElementRange;
  sheets: ElementRange;
  sheetElements: ElementRange[];
  relationshipAttribute: string;
}

type DefinedNameCheck = "records-present" | "exact" | "absent" | "ignore";

function invalidMetadata(message: string): never {
  throw new TemplateCompilerError("invalid_xlsx_metadata", message);
}

function metadataConflict(message: string): never {
  throw new TemplateCompilerError("xlsx_metadata_conflict", message);
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

function tagPrefix(name: string): string {
  const separator = name.lastIndexOf(":");
  return separator < 0 ? "" : `${name.slice(0, separator)}:`;
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

function scanXmlTags(xml: string): XmlTag[] {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new TemplateCompilerError(
      "unsafe_xml_declaration",
      "Книга содержит запрещённое объявление XML."
    );
  }
  const tags: XmlTag[] = [];
  const stack: string[] = [];
  const namespaceScopes: Map<string, string>[] = [
    new Map([["xml", XML_NAMESPACE]])
  ];
  let index = 0;
  while (index < xml.length) {
    const opening = xml.indexOf("<", index);
    if (opening < 0) break;
    if (xml.startsWith("<!--", opening)) {
      const closing = xml.indexOf("-->", opening + 4);
      if (closing < 0) invalidMetadata("Одна из XML-частей XLSX повреждена.");
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<?", opening)) {
      const closing = xml.indexOf("?>", opening + 2);
      if (closing < 0) invalidMetadata("Одна из XML-частей XLSX повреждена.");
      index = closing + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", opening)) {
      const closing = xml.indexOf("]]>", opening + 9);
      if (closing < 0) invalidMetadata("Одна из XML-частей XLSX повреждена.");
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
    if (closingIndex < 0) invalidMetadata("Одна из XML-частей XLSX повреждена.");
    const raw = xml.slice(opening + 1, closingIndex).trim();
    const closing = raw.startsWith("/");
    const selfClosing = !closing && raw.endsWith("/");
    const source = closing
      ? raw.slice(1).trim()
      : selfClosing
        ? raw.slice(0, -1).trimEnd()
        : raw;
    const name = source.split(/\s/u, 1)[0] ?? "";
    if (name.length === 0) invalidMetadata("Одна из XML-частей XLSX повреждена.");
    const attributes = closing
      ? new Map<string, string>()
      : parseXmlAttributes(source);
    let namespaceScope = namespaceScopes.at(-1) ?? new Map<string, string>();
    if (!closing) {
      namespaceScope = new Map(namespaceScope);
      for (const [attributeName, uri] of attributes) {
        if (attributeName !== "xmlns" && !attributeName.startsWith("xmlns:")) {
          continue;
        }
        const prefix = attributeName === "xmlns" ? "" : attributeName.slice(6);
        if (
          prefix === "xmlns" ||
          (prefix === "xml" && uri !== XML_NAMESPACE) ||
          (prefix !== "xml" && uri === XML_NAMESPACE) ||
          uri === XMLNS_NAMESPACE
        ) {
          invalidMetadata("Одна из XML-частей XLSX неверно объявляет пространство имён.");
        }
        namespaceScope.set(prefix, uri);
      }
    }
    const prefix = tagPrefix(name).slice(0, -1);
    const namespaceUri = namespaceScope.get(prefix) ?? null;
    if (prefix.length > 0 && namespaceUri === null) {
      invalidMetadata("Одна из XML-частей XLSX использует необъявленный префикс.");
    }
    const attributeNamespaces = new Map<string, string | null>();
    const expandedAttributes = new Set<string>();
    for (const attributeName of attributes.keys()) {
      if (attributeName === "xmlns" || attributeName.startsWith("xmlns:")) {
        attributeNamespaces.set(attributeName, XMLNS_NAMESPACE);
        continue;
      }
      const attributePrefix = tagPrefix(attributeName).slice(0, -1);
      const attributeNamespace =
        attributePrefix.length === 0
          ? null
          : (namespaceScope.get(attributePrefix) ?? null);
      if (attributePrefix.length > 0 && attributeNamespace === null) {
        invalidMetadata("Одна из XML-частей XLSX использует необъявленный префикс атрибута.");
      }
      const expanded = `${attributeNamespace ?? ""}\u0000${localName(attributeName)}`;
      if (expandedAttributes.has(expanded)) {
        invalidMetadata("Одна из XML-частей XLSX повторяет XML-атрибут.");
      }
      expandedAttributes.add(expanded);
      attributeNamespaces.set(attributeName, attributeNamespace);
    }
    if (closing) {
      if (stack.pop() !== name) {
        invalidMetadata("Одна из XML-частей XLSX имеет нарушенную вложенность.");
      }
      namespaceScopes.pop();
    } else if (!selfClosing) {
      stack.push(name);
      namespaceScopes.push(namespaceScope);
    }
    tags.push({
      start: opening,
      end: closingIndex + 1,
      name,
      localName: localName(name),
      namespaceUri,
      attributes,
      attributeNamespaces,
      closing,
      selfClosing,
      raw
    });
    index = closingIndex + 1;
  }
  if (stack.length !== 0) {
    invalidMetadata("Одна из XML-частей XLSX имеет незакрытый элемент.");
  }
  return tags;
}

function matchingCloseIndex(tags: readonly XmlTag[], openIndex: number): number {
  const opening = tags[openIndex];
  if (opening === undefined || opening.closing) {
    invalidMetadata("Одна из XML-частей XLSX повреждена.");
  }
  if (opening.selfClosing) return openIndex;
  let depth = 1;
  for (let index = openIndex + 1; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag === undefined || tag.name !== opening.name) continue;
    if (!tag.closing && !tag.selfClosing) depth += 1;
    else if (tag.closing) depth -= 1;
    if (depth === 0) return index;
  }
  return invalidMetadata("Одна из XML-частей XLSX имеет незакрытый элемент.");
}

function elementRange(tags: readonly XmlTag[], openIndex: number): ElementRange {
  const open = tags[openIndex];
  if (open === undefined || open.closing) {
    return invalidMetadata("Одна из XML-частей XLSX повреждена.");
  }
  const closeIndex = matchingCloseIndex(tags, openIndex);
  const close = tags[closeIndex];
  if (close === undefined) {
    return invalidMetadata("Одна из XML-частей XLSX повреждена.");
  }
  return { open, close, openIndex, closeIndex };
}

function rootElement(xml: string, local: string, namespace: string): {
  tags: XmlTag[];
  root: ElementRange;
} {
  const tags = scanXmlTags(xml);
  const first = tags[0];
  if (first === undefined || first.closing || first.localName !== local) {
    invalidMetadata(`В XLSX отсутствует корневой элемент «${local}».`);
  }
  const root = elementRange(tags, 0);
  if (root.closeIndex !== tags.length - 1) {
    invalidMetadata(`XML-часть «${local}» содержит данные вне корневого элемента.`);
  }
  const preamble = xml
    .slice(0, root.open.start)
    .replace(/<\?xml[\s\S]*?\?>/giu, "")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .trim();
  const trailing = xml.slice(root.close.end).trim();
  if (preamble.length !== 0 || trailing.length !== 0) {
    invalidMetadata(`XML-часть «${local}» содержит данные вне корневого элемента.`);
  }
  if (first.namespaceUri !== namespace) {
    invalidMetadata(`Корневое пространство имён «${local}» не поддерживается.`);
  }
  return { tags, root };
}

function directChildren(
  tags: readonly XmlTag[],
  parent: ElementRange,
  wantedLocalName?: string,
  expectedNamespace?: string
): ElementRange[] {
  const result: ElementRange[] = [];
  let index = parent.openIndex + 1;
  while (index < parent.closeIndex) {
    const tag = tags[index];
    if (tag === undefined || tag.closing) {
      invalidMetadata("Одна из XML-частей XLSX имеет нарушенную вложенность.");
    }
    const range = elementRange(tags, index);
    if (wantedLocalName === undefined || tag.localName === wantedLocalName) {
      if (
        expectedNamespace !== undefined &&
        tag.namespaceUri !== expectedNamespace
      ) {
        invalidMetadata(
          `Элемент «${tag.localName}» использует неподдерживаемое пространство имён.`
        );
      }
      result.push(range);
    }
    index = range.closeIndex + 1;
  }
  return result;
}

function validXmlCodePoint(value: number): boolean {
  return (
    value === 0x9 ||
    value === 0xa ||
    value === 0xd ||
    (value >= 0x20 && value <= 0xd7ff) ||
    (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff)
  );
}

function decodeXmlAttribute(value: string): string {
  if (value.includes("<")) {
    invalidMetadata("XML-атрибут XLSX содержит недопустимый символ «<».");
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !validXmlCodePoint(codePoint)) {
      invalidMetadata("XML-атрибут XLSX содержит недопустимый символ.");
    }
  }
  if (
    /&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9A-Fa-f]+;)/u.test(value)
  ) {
    invalidMetadata("XML-атрибут XLSX содержит неподдерживаемую сущность.");
  }
  const normalizedWhitespace = value.replace(/[\t\r\n]/gu, " ");
  const numeric = normalizedWhitespace.replace(
    /&#(?:([0-9]+)|x([0-9A-Fa-f]+));/gu,
    (_match, decimal: string | undefined, hexadecimal: string | undefined) => {
      const codePoint = Number.parseInt(decimal ?? hexadecimal ?? "", decimal === undefined ? 16 : 10);
      if (!Number.isSafeInteger(codePoint) || !validXmlCodePoint(codePoint)) {
        invalidMetadata("XML-атрибут XLSX содержит недопустимый символ.");
      }
      return String.fromCodePoint(codePoint);
    }
  );
  return numeric
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function parseXmlAttributes(rawTag: string): Map<string, string> {
  const normalized = rawTag
    .trim()
    .replace(/^\//u, "")
    .replace(/\/$/u, "")
    .trimEnd();
  const name = normalized.split(/\s/u, 1)[0] ?? "";
  const attributes = new Map<string, string>();
  let position = name.length;
  const expression = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(["'])([\s\S]*?)\2/gy;
  while (position < normalized.length) {
    expression.lastIndex = position;
    const match = expression.exec(normalized);
    if (match === null) {
      invalidMetadata("Одна из XML-частей XLSX содержит недопустимый атрибут.");
    }
    const attributeName = match[1] ?? "";
    if (attributes.has(attributeName)) {
      invalidMetadata("Одна из XML-частей XLSX повторяет XML-атрибут.");
    }
    attributes.set(attributeName, decodeXmlAttribute(match[3] ?? ""));
    position = expression.lastIndex;
  }
  return attributes;
}

function attributeValue(rawTag: string, name: string): string | null {
  return parseXmlAttributes(rawTag).get(name) ?? null;
}

function namespacedIdAttribute(sheet: XmlTag): string | null {
  for (const attributeName of sheet.attributes.keys()) {
    if (
      localName(attributeName) === "id" &&
      sheet.attributeNamespaces.get(attributeName) ===
        OFFICE_RELATIONSHIPS_NAMESPACE
    ) {
      return attributeName;
    }
  }
  return null;
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
  return decodeXmlAttribute(value);
}

function replaceEntry(
  entries: readonly OoxmlPackageEntry[],
  name: string,
  content: Buffer
): OoxmlPackageEntry[] {
  let replaced = false;
  const result = entries.map((entry) => {
    if (entry.name !== name) return entry;
    replaced = true;
    return { ...entry, content };
  });
  if (!replaced) {
    invalidMetadata(`В XLSX отсутствует обязательная часть «${name}».`);
  }
  return result;
}

function normalizeRecord(record: XlsxMetadataRecord): XlsxMetadataRecord {
  const expectedPattern =
    record.kind === "field"
      ? /^_DOCOMATOR_[A-F0-9]{24}$/u
      : /^_DOCOMATOR_REPEAT_[A-F0-9]{24}$/u;
  const expectedTarget =
    record.kind === "field"
      ? /^'(?:[^']|'')+'!\$[A-Z]{1,4}\$[1-9][0-9]{0,6}$/u
      : /^'(?:[^']|'')+'!\$[A-Z]{1,4}\$[1-9][0-9]{0,6}:\$[A-Z]{1,4}\$[1-9][0-9]{0,6}$/u;
  if (
    !expectedPattern.test(record.identifier) ||
    record.part !== WORKBOOK_PART ||
    !expectedTarget.test(record.target) ||
    record.target.length > 1_000 ||
    /[\u0000-\u001f\u007f]/u.test(record.target)
  ) {
    invalidMetadata("Запись служебного листа XLSX имеет недопустимый формат.");
  }
  return {
    kind: record.kind,
    identifier: record.identifier,
    part: WORKBOOK_PART,
    target: record.target
  };
}

function normalizeRecords(records: readonly XlsxMetadataRecord[]): XlsxMetadataRecord[] {
  if (records.length < 1 || records.length > MAX_METADATA_RECORDS) {
    invalidMetadata("Служебный лист XLSX содержит недопустимое число записей.");
  }
  const normalized = records.map(normalizeRecord).sort(
    (left, right) =>
      left.kind.localeCompare(right.kind, "en") ||
      left.identifier.localeCompare(right.identifier, "en")
  );
  const identifiers = normalized.map((record) => record.identifier.toUpperCase());
  if (new Set(identifiers).size !== identifiers.length) {
    invalidMetadata("Служебный лист XLSX содержит повторяющуюся привязку.");
  }
  return normalized;
}

function inlineCell(address: string, value: string): string {
  return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

function metadataWorksheet(recordsValue: readonly XlsxMetadataRecord[]): Buffer {
  const records = normalizeRecords(recordsValue);
  const rows = [
    `<row r="1">${inlineCell("A1", METADATA_MARKER)}${inlineCell("B1", String(XLSX_METADATA_VERSION))}</row>`,
    `<row r="2">${inlineCell("A2", "kind")}${inlineCell("B2", "identifier")}${inlineCell("C2", "part")}${inlineCell("D2", "target")}</row>`,
    ...records.map((record, index) => {
      const row = index + 3;
      return `<row r="${row}">${inlineCell(`A${row}`, record.kind)}${inlineCell(`B${row}`, record.identifier)}${inlineCell(`C${row}`, record.part)}${inlineCell(`D${row}`, record.target)}</row>`;
    })
  ].join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${SPREADSHEET_NAMESPACE}"><sheetData>${rows}</sheetData></worksheet>`,
    "utf8"
  );
}

function parseMetadataWorksheet(content: Buffer): XlsxMetadataRecord[] {
  const xml = content.toString("utf8");
  rootElement(xml, "worksheet", SPREADSHEET_NAMESPACE);
  const cells = [...xml.matchAll(/<c r="([A-D][1-9][0-9]{0,2})" t="inlineStr"><is><t xml:space="preserve">([^<]*)<\/t><\/is><\/c>/gu)].map(
    (match) => ({ address: match[1] ?? "", value: decodeXmlText(match[2] ?? "") })
  );
  if ((cells.length - 6) % 4 !== 0) {
    invalidMetadata("Служебный лист XLSX имеет неполную таблицу привязок.");
  }
  const values = new Map(cells.map((cell) => [cell.address, cell.value]));
  if (
    values.size !== cells.length ||
    values.get("A1") !== METADATA_MARKER ||
    values.get("B1") !== String(XLSX_METADATA_VERSION) ||
    values.get("A2") !== "kind" ||
    values.get("B2") !== "identifier" ||
    values.get("C2") !== "part" ||
    values.get("D2") !== "target"
  ) {
    invalidMetadata("Служебный лист XLSX не соответствует версии метаданных.");
  }
  const recordCount = (cells.length - 6) / 4;
  const records: XlsxMetadataRecord[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    const row = index + 3;
    const kind = values.get(`A${row}`);
    const identifier = values.get(`B${row}`);
    const part = values.get(`C${row}`);
    const target = values.get(`D${row}`);
    if (
      (kind !== "field" && kind !== "repeat") ||
      identifier === undefined ||
      part === undefined ||
      target === undefined
    ) {
      invalidMetadata("Служебный лист XLSX содержит неполную запись привязки.");
    }
    records.push({ kind, identifier, part, target });
  }
  const normalized = normalizeRecords(records);
  if (!metadataWorksheet(normalized).equals(content)) {
    invalidMetadata("Служебный лист XLSX изменён или имеет недетерминированную структуру.");
  }
  return normalized;
}

function workbookModel(entries: readonly OoxmlPackageEntry[]): WorkbookModel {
  const decoded = decodeXml(packageEntry(entries, WORKBOOK_PART).content);
  const { tags, root } = rootElement(
    decoded.text,
    "workbook",
    SPREADSHEET_NAMESPACE
  );
  const sheets = directChildren(tags, root, "sheets", SPREADSHEET_NAMESPACE);
  if (sheets.length !== 1 || sheets[0]?.open.selfClosing) {
    invalidMetadata("В XLSX не найден единственный список листов книги.");
  }
  const sheetContainer = sheets[0];
  if (sheetContainer === undefined) {
    invalidMetadata("В XLSX не найден список листов книги.");
  }
  const sheetElements = directChildren(
    tags,
    sheetContainer,
    "sheet",
    SPREADSHEET_NAMESPACE
  );
  if (sheetElements.length < 1) {
    invalidMetadata("В XLSX отсутствуют рабочие листы.");
  }
  const firstSheet = sheetElements[0];
  if (firstSheet === undefined) {
    invalidMetadata("В XLSX отсутствуют рабочие листы.");
  }
  const relationshipAttribute = namespacedIdAttribute(firstSheet.open);
  if (relationshipAttribute === null) {
    invalidMetadata("Связи рабочих листов XLSX имеют неподдерживаемый формат.");
  }
  return {
    decoded,
    root,
    sheets: sheetContainer,
    sheetElements,
    relationshipAttribute
  };
}

function relationshipElements(entries: readonly OoxmlPackageEntry[]): {
  decoded: DecodedXml;
  root: ElementRange;
  elements: ElementRange[];
} {
  const decoded = decodeXml(
    packageEntry(entries, WORKBOOK_RELATIONSHIPS_PART).content
  );
  const { tags, root } = rootElement(
    decoded.text,
    "Relationships",
    PACKAGE_RELATIONSHIPS_NAMESPACE
  );
  return {
    decoded,
    root,
    elements: directChildren(
      tags,
      root,
      "Relationship",
      PACKAGE_RELATIONSHIPS_NAMESPACE
    )
  };
}

function contentTypeElements(entries: readonly OoxmlPackageEntry[]): {
  decoded: DecodedXml;
  root: ElementRange;
  overrides: ElementRange[];
} {
  const decoded = decodeXml(packageEntry(entries, CONTENT_TYPES_PART).content);
  const { tags, root } = rootElement(
    decoded.text,
    "Types",
    CONTENT_TYPES_NAMESPACE
  );
  return {
    decoded,
    root,
    overrides: directChildren(
      tags,
      root,
      "Override",
      CONTENT_TYPES_NAMESPACE
    )
  };
}

function technicalDefinedNames(model: WorkbookModel): Map<string, string> {
  const { tags, root } = rootElement(
    model.decoded.text,
    "workbook",
    SPREADSHEET_NAMESPACE
  );
  const containers = directChildren(
    tags,
    root,
    "definedNames",
    SPREADSHEET_NAMESPACE
  );
  if (containers.length > 1) {
    invalidMetadata("Книга содержит несколько списков именованных диапазонов.");
  }
  const names = new Map<string, string>();
  const container = containers[0];
  if (container === undefined) return names;
  for (const range of directChildren(
    tags,
    container,
    "definedName",
    SPREADSHEET_NAMESPACE
  )) {
    const name = attributeValue(range.open.raw, "name") ?? "";
    if (!name.toUpperCase().startsWith("_DOCOMATOR_")) continue;
    if (range.open.selfClosing || model.decoded.text.slice(range.open.end, range.close.start).includes("<")) {
      invalidMetadata("Техническая именованная привязка XLSX повреждена.");
    }
    const folded = name.toUpperCase();
    if (names.has(folded)) {
      invalidMetadata("Книга содержит повторяющуюся техническую привязку XLSX.");
    }
    names.set(
      folded,
      decodeXmlText(model.decoded.text.slice(range.open.end, range.close.start))
    );
  }
  return names;
}

function verifyDefinedNames(
  model: WorkbookModel,
  records: readonly XlsxMetadataRecord[],
  mode: DefinedNameCheck
): void {
  if (mode === "ignore") return;
  const names = technicalDefinedNames(model);
  if (mode === "absent") {
    if (names.size !== 0) {
      invalidMetadata("В готовой книге осталась техническая именованная привязка.");
    }
    return;
  }
  for (const record of records) {
    if (names.get(record.identifier.toUpperCase()) !== record.target) {
      invalidMetadata("Служебная запись XLSX не совпадает с именованной привязкой.");
    }
  }
  if (mode === "exact" && names.size !== records.length) {
    invalidMetadata("Набор служебных записей XLSX не совпадает с техническими привязками.");
  }
}

function inspectMetadata(
  entries: readonly OoxmlPackageEntry[],
  definedNameCheck: DefinedNameCheck
): { model: WorkbookModel; records: XlsxMetadataRecord[] } | null {
  const model = workbookModel(entries);
  const metadataSheets = model.sheetElements.filter(
    (sheet) =>
      (attributeValue(sheet.open.raw, "name") ?? "").toUpperCase() ===
      XLSX_METADATA_SHEET_NAME
  );
  const partPresent = entries.some((entry) => entry.name === XLSX_METADATA_PART);
  const relationshipsPartPresent = entries.some(
    (entry) => entry.name === XLSX_METADATA_RELATIONSHIPS_PART
  );
  const relationships = relationshipElements(entries);
  const metadataRelations = relationships.elements.filter(
    (relationship) =>
      attributeValue(relationship.open.raw, "Id") === METADATA_RELATIONSHIP_ID ||
      attributeValue(relationship.open.raw, "Target") === METADATA_RELATIONSHIP_TARGET
  );
  const contentTypes = contentTypeElements(entries);
  const metadataOverrides = contentTypes.overrides.filter(
    (override) =>
      attributeValue(override.open.raw, "PartName") === METADATA_PART_NAME
  );
  const anyArtifact =
    metadataSheets.length > 0 ||
    partPresent ||
    relationshipsPartPresent ||
    metadataRelations.length > 0 ||
    metadataOverrides.length > 0;
  if (!anyArtifact) return null;
  if (relationshipsPartPresent) {
    metadataConflict("Служебный лист _AI_META не может содержать собственные связи.");
  }
  if (
    metadataSheets.length !== 1 ||
    !partPresent ||
    metadataRelations.length !== 1 ||
    metadataOverrides.length !== 1
  ) {
    metadataConflict("Книга содержит неполный или конфликтующий служебный лист _AI_META.");
  }
  const sheet = metadataSheets[0];
  const relationship = metadataRelations[0];
  const override = metadataOverrides[0];
  if (sheet === undefined || relationship === undefined || override === undefined) {
    metadataConflict("Книга содержит неполный служебный лист _AI_META.");
  }
  const metadataRelationshipAttribute = namespacedIdAttribute(sheet.open);
  if (
    attributeValue(sheet.open.raw, "name") !== XLSX_METADATA_SHEET_NAME ||
    attributeValue(sheet.open.raw, "state") !== "veryHidden" ||
    metadataRelationshipAttribute === null ||
    attributeValue(sheet.open.raw, metadataRelationshipAttribute) !==
      METADATA_RELATIONSHIP_ID ||
    attributeValue(relationship.open.raw, "Id") !== METADATA_RELATIONSHIP_ID ||
    attributeValue(relationship.open.raw, "Type") !==
      WORKSHEET_RELATIONSHIP_TYPE ||
    attributeValue(relationship.open.raw, "Target") !==
      METADATA_RELATIONSHIP_TARGET ||
    attributeValue(relationship.open.raw, "TargetMode") !== null ||
    attributeValue(override.open.raw, "ContentType") !==
      WORKSHEET_CONTENT_TYPE
  ) {
    invalidMetadata("Служебный лист _AI_META имеет неподдерживаемую связь или видимость.");
  }
  const records = parseMetadataWorksheet(
    packageEntry(entries, XLSX_METADATA_PART).content
  );
  verifyDefinedNames(model, records, definedNameCheck);
  return { model, records };
}

function compareRecords(
  actual: readonly XlsxMetadataRecord[],
  expectedValue: readonly XlsxMetadataRecord[],
  exact: boolean
): void {
  const expected = normalizeRecords(expectedValue);
  const actualById = new Map(
    actual.map((record) => [record.identifier.toUpperCase(), record])
  );
  for (const record of expected) {
    if (
      JSON.stringify(actualById.get(record.identifier.toUpperCase())) !==
      JSON.stringify(record)
    ) {
      invalidMetadata("Служебный лист XLSX не содержит ожидаемую привязку.");
    }
  }
  if (exact && actual.length !== expected.length) {
    invalidMetadata("Служебный лист XLSX содержит неожиданные привязки.");
  }
}

export function verifyXlsxMetadata(
  entries: readonly OoxmlPackageEntry[],
  options: VerifyXlsxMetadataOptions = {}
): XlsxMetadataRecord[] {
  const inspected = inspectMetadata(
    entries,
    options.definedNames === "absent"
      ? "absent"
      : options.definedNames === "ignore"
        ? "ignore"
        : "exact"
  );
  if (inspected === null) {
    throw new TemplateCompilerError(
      "xlsx_metadata_missing",
      "В книге отсутствует обязательный служебный лист _AI_META. Повторно проверьте и активируйте шаблон."
    );
  }
  if (options.expectedRecords !== undefined) {
    compareRecords(
      inspected.records,
      options.expectedRecords,
      options.exactExpectedRecords ?? false
    );
  }
  return inspected.records;
}

export function assertXlsxMetadataAbsent(
  entries: readonly OoxmlPackageEntry[]
): void {
  const inspected = inspectMetadata(entries, "ignore");
  if (inspected !== null) {
    metadataConflict(
      "Исходная книга уже содержит зарезервированный служебный лист _AI_META. Переименуйте пользовательский лист и повторите загрузку."
    );
  }
}

export function hasCanonicalXlsxMetadata(
  entries: readonly OoxmlPackageEntry[]
): boolean {
  const metadata = entries.find((entry) => entry.name === XLSX_METADATA_PART);
  if (metadata === undefined) return false;
  try {
    parseMetadataWorksheet(metadata.content);
  } catch (error) {
    if (
      error instanceof TemplateCompilerError &&
      !metadata.content.includes(Buffer.from(METADATA_MARKER, "utf8"))
    ) {
      return false;
    }
    throw error;
  }
  return inspectMetadata(entries, "ignore") !== null;
}

function relationshipTargetPart(target: string): string | null {
  if (
    target.length === 0 ||
    target.includes("\\") ||
    target.includes("?") ||
    target.includes("#") ||
    /[\u0000-\u001f\u007f]/u.test(target)
  ) {
    return null;
  }
  const raw = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const segments = raw.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    return null;
  }
  return segments.join("/");
}

export function verifyXlsxWorksheetBinding(
  entries: readonly OoxmlPackageEntry[],
  sheetName: string,
  sheetPath: string
): void {
  const model = workbookModel(entries);
  const sheets = model.sheetElements.filter(
    (sheet) => attributeValue(sheet.open.raw, "name") === sheetName
  );
  if (sheets.length !== 1) {
    invalidMetadata("Техническая привязка XLSX указывает на неизвестный лист.");
  }
  const sheet = sheets[0];
  if (sheet === undefined) {
    invalidMetadata("Техническая привязка XLSX указывает на неизвестный лист.");
  }
  const relationshipAttribute = namespacedIdAttribute(sheet.open);
  const relationshipId =
    relationshipAttribute === null
      ? null
      : attributeValue(sheet.open.raw, relationshipAttribute);
  if (relationshipId === null) {
    invalidMetadata("Выбранный лист XLSX не имеет безопасной связи с частью пакета.");
  }
  const relationships = relationshipElements(entries).elements.filter(
    (relationship) =>
      attributeValue(relationship.open.raw, "Id") === relationshipId
  );
  const relationship = relationships[0];
  if (
    relationships.length !== 1 ||
    relationship === undefined ||
    attributeValue(relationship.open.raw, "Type") !==
      WORKSHEET_RELATIONSHIP_TYPE ||
    attributeValue(relationship.open.raw, "TargetMode") !== null
  ) {
    invalidMetadata("Связь выбранного листа XLSX имеет неподдерживаемый формат.");
  }
  const target = attributeValue(relationship.open.raw, "Target");
  if (
    target === null ||
    relationshipTargetPart(target) !== sheetPath ||
    !entries.some((entry) => entry.name === sheetPath)
  ) {
    invalidMetadata("Сохранённый путь листа XLSX не совпадает со связью книги.");
  }
}

function addMetadataArtifacts(
  entries: readonly OoxmlPackageEntry[],
  records: readonly XlsxMetadataRecord[]
): OoxmlPackageEntry[] {
  const model = workbookModel(entries);
  const sheetIds = new Set<number>();
  for (const sheet of model.sheetElements) {
    const raw = attributeValue(sheet.open.raw, "sheetId") ?? "";
    if (!/^[1-9][0-9]{0,9}$/u.test(raw)) {
      invalidMetadata("Книга содержит недопустимый идентификатор рабочего листа.");
    }
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id > 4_294_967_295 || sheetIds.has(id)) {
      invalidMetadata("Книга содержит повторяющийся идентификатор рабочего листа.");
    }
    sheetIds.add(id);
  }
  let sheetId = 1;
  while (sheetIds.has(sheetId)) sheetId += 1;
  if (sheetId > 4_294_967_295) {
    invalidMetadata("Не удалось назначить идентификатор служебного листа XLSX.");
  }
  const workbookPrefix = tagPrefix(model.root.open.name);
  const sheetRelationshipPrefix = tagPrefix(
    model.relationshipAttribute
  ).slice(0, -1);
  const relationshipNamespaceDeclaration =
    model.root.open.attributes.get(`xmlns:${sheetRelationshipPrefix}`) ===
    OFFICE_RELATIONSHIPS_NAMESPACE
      ? ""
      : ` xmlns:${sheetRelationshipPrefix}="${OFFICE_RELATIONSHIPS_NAMESPACE}"`;
  const sheetNode = `<${workbookPrefix}sheet name="${XLSX_METADATA_SHEET_NAME}" sheetId="${sheetId}" state="veryHidden"${relationshipNamespaceDeclaration} ${model.relationshipAttribute}="${METADATA_RELATIONSHIP_ID}"/>`;
  const workbookXml =
    model.decoded.text.slice(0, model.sheets.close.start) +
    sheetNode +
    model.decoded.text.slice(model.sheets.close.start);
  let updated = replaceEntry(
    entries,
    WORKBOOK_PART,
    encodeXml(model.decoded, workbookXml)
  );

  const relationships = relationshipElements(updated);
  if (
    relationships.elements.some(
      (relationship) =>
        attributeValue(relationship.open.raw, "Id") ===
          METADATA_RELATIONSHIP_ID ||
        attributeValue(relationship.open.raw, "Target") ===
          METADATA_RELATIONSHIP_TARGET
    )
  ) {
    metadataConflict("Идентификатор связи служебного листа уже занят.");
  }
  const relationshipPrefix = tagPrefix(relationships.root.open.name);
  const relationshipNode = `<${relationshipPrefix}Relationship Id="${METADATA_RELATIONSHIP_ID}" Type="${WORKSHEET_RELATIONSHIP_TYPE}" Target="${METADATA_RELATIONSHIP_TARGET}"/>`;
  const relationshipsXml =
    relationships.decoded.text.slice(0, relationships.root.close.start) +
    relationshipNode +
    relationships.decoded.text.slice(relationships.root.close.start);
  updated = replaceEntry(
    updated,
    WORKBOOK_RELATIONSHIPS_PART,
    encodeXml(relationships.decoded, relationshipsXml)
  );

  const contentTypes = contentTypeElements(updated);
  if (
    contentTypes.overrides.some(
      (override) =>
        attributeValue(override.open.raw, "PartName") === METADATA_PART_NAME
    )
  ) {
    metadataConflict("Тип части служебного листа уже зарегистрирован.");
  }
  const contentTypePrefix = tagPrefix(contentTypes.root.open.name);
  const overrideNode = `<${contentTypePrefix}Override PartName="${METADATA_PART_NAME}" ContentType="${WORKSHEET_CONTENT_TYPE}"/>`;
  const contentTypesXml =
    contentTypes.decoded.text.slice(0, contentTypes.root.close.start) +
    overrideNode +
    contentTypes.decoded.text.slice(contentTypes.root.close.start);
  updated = replaceEntry(
    updated,
    CONTENT_TYPES_PART,
    encodeXml(contentTypes.decoded, contentTypesXml)
  );
  if (updated.some((entry) => entry.name === XLSX_METADATA_PART)) {
    metadataConflict("Часть служебного листа уже существует без согласованной связи.");
  }
  return [
    ...updated,
    {
      name: XLSX_METADATA_PART,
      content: metadataWorksheet(records),
      isDirectory: false
    }
  ];
}

export function upsertXlsxMetadataRecord(
  entries: readonly OoxmlPackageEntry[],
  recordValue: XlsxMetadataRecord
): UpsertXlsxMetadataResult {
  const record = normalizeRecord(recordValue);
  const inspected = inspectMetadata(entries, "records-present");
  const current = inspected?.records ?? [];
  const existing = current.find(
    (candidate) =>
      candidate.identifier.toUpperCase() === record.identifier.toUpperCase()
  );
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(record)) {
    invalidMetadata("Техническая привязка уже имеет другую служебную запись XLSX.");
  }
  const records = normalizeRecords(existing === undefined ? [...current, record] : current);
  let updated: OoxmlPackageEntry[];
  let modifiedParts: string[];
  if (inspected === null) {
    updated = addMetadataArtifacts(entries, records);
    modifiedParts = [
      CONTENT_TYPES_PART,
      WORKBOOK_PART,
      WORKBOOK_RELATIONSHIPS_PART,
      XLSX_METADATA_PART
    ];
  } else {
    updated = replaceEntry(entries, XLSX_METADATA_PART, metadataWorksheet(records));
    modifiedParts = [XLSX_METADATA_PART];
  }
  const verified = verifyXlsxMetadata(updated, {
    expectedRecords: records,
    exactExpectedRecords: true,
    definedNames: "present"
  });
  return { entries: updated, modifiedParts, records: verified };
}

export function xlsxMetadataRecord(
  kind: XlsxMetadataRecord["kind"],
  binding: {
    identifier: string;
    part: string;
    target: string;
  }
): XlsxMetadataRecord {
  return normalizeRecord({
    kind,
    identifier: binding.identifier,
    part: binding.part,
    target: binding.target
  });
}
