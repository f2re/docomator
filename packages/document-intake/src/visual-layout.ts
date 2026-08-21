import path from "node:path";

import yauzl, { type Entry, type ZipFile } from "yauzl";

import {
  DocumentIntakeError,
  inspectOoxmlBuffer,
  type InspectOoxmlInput
} from "./intake.js";
import {
  analyzeOoxmlBuffer,
  type DocxParagraphElement,
  type XlsxCellElement
} from "./structure.js";

const MAX_VISUAL_XML_BYTES = 16 * 1024 * 1024;
const MAX_VISUAL_MEDIA_BYTES = 4 * 1024 * 1024;
const MAX_VISUAL_MEDIA_TOTAL_BYTES = 12 * 1024 * 1024;

export interface VisualTextStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string | null;
  backgroundColor: string | null;
  fontFamily: string | null;
  fontSizePt: number | null;
  verticalAlign: "baseline" | "superscript" | "subscript";
  caps: boolean;
  smallCaps: boolean;
}

export interface VisualParagraphStyle {
  alignment: "left" | "center" | "right" | "justify" | null;
  marginLeftPt: number | null;
  marginRightPt: number | null;
  firstLinePt: number | null;
  hangingPt: number | null;
  spaceBeforePt: number | null;
  spaceAfterPt: number | null;
  lineHeightPt: number | null;
  backgroundColor: string | null;
}

export interface VisualBorderSide {
  style: string | null;
  color: string | null;
  widthPt: number | null;
}

export interface VisualCellStyle {
  backgroundColor: string | null;
  verticalAlign: "top" | "center" | "bottom" | null;
  widthPt: number | null;
  borders: {
    top: VisualBorderSide;
    right: VisualBorderSide;
    bottom: VisualBorderSide;
    left: VisualBorderSide;
  };
}

export interface VisualEmbeddedImage {
  relationshipId: string;
  mediaPath: string;
  mimeType: string | null;
  dataUri: string | null;
  widthPt: number | null;
  heightPt: number | null;
  altText: string;
  anchor: string | null;
}

export interface VisualDocxParagraph {
  elementId: string;
  paragraphStyle: VisualParagraphStyle;
  runs: VisualTextStyle[];
  images: VisualEmbeddedImage[];
}

export interface VisualDocxTable {
  part: string;
  tableIndex: number;
  widthPt: number | null;
  columnWidthsPt: number[];
  cells: Array<{
    rowIndex: number;
    columnIndex: number;
    columnSpan: number;
    verticalMerge: "restart" | "continue" | null;
    style: VisualCellStyle;
  }>;
}

export interface VisualDocxLayout {
  page: {
    widthPt: number | null;
    heightPt: number | null;
    orientation: "portrait" | "landscape" | null;
    margins: {
      topPt: number | null;
      rightPt: number | null;
      bottomPt: number | null;
      leftPt: number | null;
      headerPt: number | null;
      footerPt: number | null;
    };
  };
  paragraphs: VisualDocxParagraph[];
  tables: VisualDocxTable[];
}

export interface VisualXlsxCellStyle {
  font: VisualTextStyle;
  fillColor: string | null;
  horizontalAlign: "left" | "center" | "right" | "justify" | null;
  verticalAlign: "top" | "center" | "bottom" | null;
  wrapText: boolean;
  borders: VisualCellStyle["borders"];
  numberFormat: string | null;
}

export interface VisualXlsxSheet {
  name: string;
  path: string;
  columns: Array<{ column: number; widthChars: number; hidden: boolean }>;
  rows: Array<{ row: number; heightPt: number | null; hidden: boolean }>;
  merges: string[];
  header: { left: string; center: string; right: string };
  footer: { left: string; center: string; right: string };
  cells: Array<{
    elementId: string;
    address: string;
    row: number;
    column: number;
    displayValue: string;
    style: VisualXlsxCellStyle;
  }>;
  images: VisualEmbeddedImage[];
}

export interface VisualXlsxLayout {
  sheets: VisualXlsxSheet[];
}

export interface DocumentVisualLayoutReport {
  fileName: string;
  format: "docx" | "xlsx";
  sourceSha256: string;
  warnings: string[];
  docx: VisualDocxLayout | null;
  xlsx: VisualXlsxLayout | null;
}

export interface AnalyzeVisualOoxmlInput extends InspectOoxmlInput {}

interface XmlNode {
  localName: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string[];
}

interface Relationship {
  id: string;
  target: string;
  type: string;
  external: boolean;
}

interface PackageEntry {
  name: string;
  buffer: Buffer;
}

interface DocxStyleDefinition {
  id: string;
  basedOn: string | null;
  paragraph: Partial<VisualParagraphStyle>;
  run: Partial<VisualTextStyle>;
}

interface XlsxFont {
  style: VisualTextStyle;
}

interface XlsxFill {
  color: string | null;
}

interface XlsxBorder {
  value: VisualCellStyle["borders"];
}

interface XlsxCellFormat {
  fontId: number;
  fillId: number;
  borderId: number;
  numFmtId: number;
  horizontalAlign: VisualXlsxCellStyle["horizontalAlign"];
  verticalAlign: VisualXlsxCellStyle["verticalAlign"];
  wrapText: boolean;
}

function xmlLocalName(name: string): string {
  const index = name.lastIndexOf(":");
  return index < 0 ? name : name.slice(index + 1);
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/giu,
    (_source, entity: string) => {
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

function parseTag(source: string): { name: string; attributes: Record<string, string> } {
  let index = 0;
  while (/\s/u.test(source[index] ?? "")) index += 1;
  const nameStart = index;
  while (index < source.length && !/\s/u.test(source[index] ?? "")) index += 1;
  const name = source.slice(nameStart, index);
  if (!name) throw new DocumentIntakeError("invalid_xml_part", 422, "Повреждён XML-тег документа.");
  const attributes: Record<string, string> = {};
  while (index < source.length) {
    while (/\s/u.test(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    const start = index;
    while (index < source.length && !/[\s=]/u.test(source[index] ?? "")) index += 1;
    const key = source.slice(start, index);
    while (/\s/u.test(source[index] ?? "")) index += 1;
    if (source[index] !== "=") throw new DocumentIntakeError("invalid_xml_part", 422, "Повреждён XML-атрибут документа.");
    index += 1;
    while (/\s/u.test(source[index] ?? "")) index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") throw new DocumentIntakeError("invalid_xml_part", 422, "Повреждено значение XML-атрибута.");
    index += 1;
    const valueStart = index;
    while (index < source.length && source[index] !== quote) index += 1;
    if (index >= source.length) throw new DocumentIntakeError("invalid_xml_part", 422, "Незавершён XML-атрибут документа.");
    attributes[key] = decodeXmlEntities(source.slice(valueStart, index));
    index += 1;
  }
  return { name, attributes };
}

function parseXml(xml: string, partName: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new DocumentIntakeError(
      "unsafe_xml_declaration",
      422,
      `Часть «${partName}» содержит запрещённое объявление XML.`
    );
  }
  const root: XmlNode = { localName: "#root", attributes: {}, children: [], text: [] };
  const stack = [root];
  let index = 0;
  while (index < xml.length) {
    const opening = xml.indexOf("<", index);
    if (opening < 0) {
      if (index < xml.length) stack.at(-1)?.text.push(decodeXmlEntities(xml.slice(index)));
      break;
    }
    if (opening > index) stack.at(-1)?.text.push(decodeXmlEntities(xml.slice(index, opening)));
    if (xml.startsWith("<!--", opening)) {
      const closing = xml.indexOf("-->", opening + 4);
      if (closing < 0) throw new DocumentIntakeError("invalid_xml_part", 422, `Часть «${partName}» содержит повреждённый комментарий.`);
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<?", opening)) {
      const closing = xml.indexOf("?>", opening + 2);
      if (closing < 0) throw new DocumentIntakeError("invalid_xml_part", 422, `Часть «${partName}» содержит повреждённую инструкцию.`);
      index = closing + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", opening)) {
      const closing = xml.indexOf("]]>", opening + 9);
      if (closing < 0) throw new DocumentIntakeError("invalid_xml_part", 422, `Часть «${partName}» содержит повреждённый CDATA.`);
      stack.at(-1)?.text.push(xml.slice(opening + 9, closing));
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<!", opening)) {
      throw new DocumentIntakeError("unsafe_xml_declaration", 422, `Часть «${partName}» содержит неподдерживаемое объявление XML.`);
    }
    const closing = findTagEnd(xml, opening + 1);
    if (closing < 0) throw new DocumentIntakeError("invalid_xml_part", 422, `Часть «${partName}» содержит незавершённый тег.`);
    const raw = xml.slice(opening + 1, closing).trim();
    if (raw.startsWith("/")) {
      if (stack.length > 1) stack.pop();
    } else {
      const selfClosing = raw.endsWith("/");
      const parsed = parseTag(selfClosing ? raw.slice(0, -1).trimEnd() : raw);
      const node: XmlNode = {
        localName: xmlLocalName(parsed.name),
        attributes: parsed.attributes,
        children: [],
        text: []
      };
      stack.at(-1)?.children.push(node);
      if (!selfClosing) stack.push(node);
    }
    index = closing + 1;
  }
  return root;
}

function attr(node: XmlNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  const direct = node.attributes[name];
  if (direct !== undefined) return direct;
  return Object.entries(node.attributes).find(([key]) => xmlLocalName(key) === name)?.[1];
}

function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((item) => item.localName === name);
}

function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((item) => item.localName === name) ?? [];
}

function descendants(node: XmlNode | undefined, name: string, result: XmlNode[] = []): XmlNode[] {
  if (!node) return result;
  for (const current of node.children) {
    if (current.localName === name) result.push(current);
    descendants(current, name, result);
  }
  return result;
}

function nodeText(node: XmlNode | undefined): string {
  if (!node) return "";
  return `${node.text.join("")}${node.children.map(nodeText).join("")}`;
}

function decodeXmlBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  const start = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
  return buffer.subarray(start).toString("utf8");
}

async function readEntry(zipFile: ZipFile, entry: Entry, maximum: number): Promise<Buffer> {
  if (entry.uncompressedSize > maximum) {
    throw new DocumentIntakeError("visual_part_too_large", 413, `Часть «${entry.fileName}» слишком велика для визуального представления.`);
  }
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
    total += chunk.length;
    if (total > maximum) {
      stream.destroy();
      throw new DocumentIntakeError("visual_part_too_large", 413, `Часть «${entry.fileName}» слишком велика для визуального представления.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function collectPackageEntries(
  buffer: Buffer,
  include: (name: string) => boolean
): Promise<Map<string, PackageEntry>> {
  const zipFile = await yauzl.fromBufferPromise(buffer, {
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true
  });
  const result = new Map<string, PackageEntry>();
  try {
    for await (const entry of zipFile.eachEntry()) {
      if (entry.fileName.endsWith("/") || !include(entry.fileName)) continue;
      const isMedia = /\/(media|embeddings)\//u.test(entry.fileName);
      const maximum = isMedia ? MAX_VISUAL_MEDIA_BYTES : MAX_VISUAL_XML_BYTES;
      result.set(entry.fileName, {
        name: entry.fileName,
        buffer: await readEntry(zipFile, entry, maximum)
      });
    }
  } finally {
    zipFile.close();
  }
  return result;
}

function xmlEntry(entries: ReadonlyMap<string, PackageEntry>, name: string): XmlNode | null {
  const entry = entries.get(name);
  return entry ? parseXml(decodeXmlBuffer(entry.buffer), name) : null;
}

function safeNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function twipsToPt(value: string | undefined): number | null {
  const number = safeNumber(value);
  return number === null ? null : number / 20;
}

function halfPointsToPt(value: string | undefined): number | null {
  const number = safeNumber(value);
  return number === null ? null : number / 2;
}

function emuToPt(value: string | undefined): number | null {
  const number = safeNumber(value);
  return number === null ? null : number / 12700;
}

function normalizedHex(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/^#/u, "").toUpperCase();
  if (/^[0-9A-F]{8}$/u.test(normalized)) return `#${normalized.slice(2)}`;
  return /^[0-9A-F]{6}$/u.test(normalized) ? `#${normalized}` : null;
}

const WORD_HIGHLIGHTS: Readonly<Record<string, string>> = {
  yellow: "#FFFF00",
  green: "#00FF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  blue: "#0000FF",
  red: "#FF0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#C0C0C0",
  black: "#000000",
  white: "#FFFFFF"
};

function enabled(node: XmlNode | undefined): boolean {
  if (!node) return false;
  const value = (attr(node, "val") ?? "1").toLowerCase();
  return value !== "0" && value !== "false" && value !== "off" && value !== "none";
}

function emptyTextStyle(): VisualTextStyle {
  return {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: null,
    backgroundColor: null,
    fontFamily: null,
    fontSizePt: null,
    verticalAlign: "baseline",
    caps: false,
    smallCaps: false
  };
}

function mergeDefined<T extends object>(base: T, patch: Partial<T>): T {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch) as Array<[keyof T, T[keyof T] | undefined]>) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function runStylePatch(rPr: XmlNode | undefined): Partial<VisualTextStyle> {
  if (!rPr) return {};
  const underline = child(rPr, "u");
  const font = child(rPr, "rFonts");
  const highlight = attr(child(rPr, "highlight"), "val");
  const vertical = attr(child(rPr, "vertAlign"), "val");
  return {
    ...(child(rPr, "b") ? { bold: enabled(child(rPr, "b")) } : {}),
    ...(child(rPr, "i") ? { italic: enabled(child(rPr, "i")) } : {}),
    ...(underline ? { underline: enabled(underline) } : {}),
    ...(child(rPr, "strike") ? { strike: enabled(child(rPr, "strike")) } : {}),
    ...(child(rPr, "color") ? { color: normalizedHex(attr(child(rPr, "color"), "val")) } : {}),
    ...(child(rPr, "highlight") ? { backgroundColor: highlight ? (WORD_HIGHLIGHTS[highlight] ?? null) : null } : {}),
    ...(font ? { fontFamily: attr(font, "ascii") ?? attr(font, "hAnsi") ?? attr(font, "eastAsia") ?? null } : {}),
    ...(child(rPr, "sz") ? { fontSizePt: halfPointsToPt(attr(child(rPr, "sz"), "val")) } : {}),
    ...(child(rPr, "caps") ? { caps: enabled(child(rPr, "caps")) } : {}),
    ...(child(rPr, "smallCaps") ? { smallCaps: enabled(child(rPr, "smallCaps")) } : {}),
    ...(vertical === "superscript" || vertical === "subscript" ? { verticalAlign: vertical } : {})
  };
}

function emptyParagraphStyle(): VisualParagraphStyle {
  return {
    alignment: null,
    marginLeftPt: null,
    marginRightPt: null,
    firstLinePt: null,
    hangingPt: null,
    spaceBeforePt: null,
    spaceAfterPt: null,
    lineHeightPt: null,
    backgroundColor: null
  };
}

function paragraphStylePatch(pPr: XmlNode | undefined): Partial<VisualParagraphStyle> {
  if (!pPr) return {};
  const alignment = attr(child(pPr, "jc"), "val");
  const ind = child(pPr, "ind");
  const spacing = child(pPr, "spacing");
  const fill = attr(child(pPr, "shd"), "fill");
  const normalizedAlignment = alignment === "center" || alignment === "right" || alignment === "both"
    ? (alignment === "both" ? "justify" : alignment)
    : alignment === "left" || alignment === "start"
      ? "left"
      : null;
  return {
    ...(alignment ? { alignment: normalizedAlignment } : {}),
    ...(ind ? { marginLeftPt: twipsToPt(attr(ind, "left") ?? attr(ind, "start")) } : {}),
    ...(ind ? { marginRightPt: twipsToPt(attr(ind, "right") ?? attr(ind, "end")) } : {}),
    ...(ind ? { firstLinePt: twipsToPt(attr(ind, "firstLine")) } : {}),
    ...(ind ? { hangingPt: twipsToPt(attr(ind, "hanging")) } : {}),
    ...(spacing ? { spaceBeforePt: twipsToPt(attr(spacing, "before")) } : {}),
    ...(spacing ? { spaceAfterPt: twipsToPt(attr(spacing, "after")) } : {}),
    ...(spacing ? { lineHeightPt: twipsToPt(attr(spacing, "line")) } : {}),
    ...(fill && fill !== "auto" ? { backgroundColor: normalizedHex(fill) } : {})
  };
}

function parseDocxStyles(styles: XmlNode | null): Map<string, DocxStyleDefinition> {
  const result = new Map<string, DocxStyleDefinition>();
  for (const style of descendants(styles ?? undefined, "style")) {
    const id = attr(style, "styleId");
    if (!id) continue;
    result.set(id, {
      id,
      basedOn: attr(child(style, "basedOn"), "val") ?? null,
      paragraph: paragraphStylePatch(child(style, "pPr")),
      run: runStylePatch(child(style, "rPr"))
    });
  }
  return result;
}

function resolveDocxStyle(
  styles: ReadonlyMap<string, DocxStyleDefinition>,
  id: string | null,
  seen: Set<string> = new Set()
): { paragraph: VisualParagraphStyle; run: VisualTextStyle } {
  if (!id || seen.has(id)) return { paragraph: emptyParagraphStyle(), run: emptyTextStyle() };
  seen.add(id);
  const style = styles.get(id);
  if (!style) return { paragraph: emptyParagraphStyle(), run: emptyTextStyle() };
  const base = resolveDocxStyle(styles, style.basedOn, seen);
  return {
    paragraph: mergeDefined(base.paragraph, style.paragraph),
    run: mergeDefined(base.run, style.run)
  };
}

function relationships(root: XmlNode | null): Map<string, Relationship> {
  const result = new Map<string, Relationship>();
  for (const relation of descendants(root ?? undefined, "Relationship")) {
    const id = attr(relation, "Id");
    const target = attr(relation, "Target");
    if (!id || !target) continue;
    result.set(id, {
      id,
      target,
      type: attr(relation, "Type") ?? "",
      external: (attr(relation, "TargetMode") ?? "").toLowerCase() === "external"
    });
  }
  return result;
}

function relationshipPart(partName: string): string {
  return path.posix.join(path.posix.dirname(partName), "_rels", `${path.posix.basename(partName)}.rels`);
}

function safeRelationshipTarget(basePart: string, target: string, prefix: "word" | "xl"): string | null {
  const resolved = path.posix.normalize(
    target.startsWith("/")
      ? target.replace(/^\/+/, "")
      : path.posix.join(path.posix.dirname(basePart), target)
  );
  if (resolved === ".." || resolved.startsWith("../") || !resolved.startsWith(`${prefix}/`)) return null;
  return resolved;
}

function mediaType(name: string): string | null {
  const extension = path.posix.extname(name).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  return null;
}

function embeddedImage(
  entries: ReadonlyMap<string, PackageEntry>,
  relation: Relationship | undefined,
  basePart: string,
  prefix: "word" | "xl",
  relationshipId: string,
  widthPt: number | null,
  heightPt: number | null,
  altText: string,
  anchor: string | null,
  mediaBudget: { used: number },
  warnings: string[]
): VisualEmbeddedImage | null {
  if (!relation || relation.external) return null;
  const target = safeRelationshipTarget(basePart, relation.target, prefix);
  if (!target) return null;
  const entry = entries.get(target);
  if (!entry) return null;
  const mimeType = mediaType(target);
  let dataUri: string | null = null;
  if (mimeType === null) {
    warnings.push(`Встроенный объект «${target}» сохранён в исходнике, но его формат не показывается в браузере.`);
  } else if (mediaBudget.used + entry.buffer.length > MAX_VISUAL_MEDIA_TOTAL_BYTES) {
    warnings.push("Суммарный размер встроенных изображений превышает безопасный предел визуального представления.");
  } else {
    mediaBudget.used += entry.buffer.length;
    dataUri = `data:${mimeType};base64,${entry.buffer.toString("base64")}`;
  }
  return {
    relationshipId,
    mediaPath: target,
    mimeType,
    dataUri,
    widthPt,
    heightPt,
    altText,
    anchor
  };
}

function borderSide(node: XmlNode | undefined): VisualBorderSide {
  if (!node) return { style: null, color: null, widthPt: null };
  const size = safeNumber(attr(node, "sz"));
  return {
    style: attr(node, "val") ?? attr(node, "style") ?? null,
    color: normalizedHex(attr(child(node, "color"), "rgb") ?? attr(node, "color")),
    widthPt: size === null ? null : size / 8
  };
}

function emptyBorders(): VisualCellStyle["borders"] {
  const empty = (): VisualBorderSide => ({ style: null, color: null, widthPt: null });
  return { top: empty(), right: empty(), bottom: empty(), left: empty() };
}

function docxCellStyle(tcPr: XmlNode | undefined): VisualCellStyle {
  const borders = child(tcPr, "tcBorders");
  const vertical = attr(child(tcPr, "vAlign"), "val");
  return {
    backgroundColor: normalizedHex(attr(child(tcPr, "shd"), "fill")),
    verticalAlign: vertical === "center" || vertical === "bottom" || vertical === "top" ? vertical : null,
    widthPt: twipsToPt(attr(child(tcPr, "tcW"), "w")),
    borders: {
      top: borderSide(child(borders, "top")),
      right: borderSide(child(borders, "right")),
      bottom: borderSide(child(borders, "bottom")),
      left: borderSide(child(borders, "left"))
    }
  };
}

function parseDocxPage(document: XmlNode | null): VisualDocxLayout["page"] {
  const sect = descendants(document ?? undefined, "sectPr").at(-1);
  const size = child(sect, "pgSz");
  const margins = child(sect, "pgMar");
  const widthPt = twipsToPt(attr(size, "w"));
  const heightPt = twipsToPt(attr(size, "h"));
  return {
    widthPt,
    heightPt,
    orientation: widthPt !== null && heightPt !== null ? (widthPt > heightPt ? "landscape" : "portrait") : null,
    margins: {
      topPt: twipsToPt(attr(margins, "top")),
      rightPt: twipsToPt(attr(margins, "right")),
      bottomPt: twipsToPt(attr(margins, "bottom")),
      leftPt: twipsToPt(attr(margins, "left")),
      headerPt: twipsToPt(attr(margins, "header")),
      footerPt: twipsToPt(attr(margins, "footer"))
    }
  };
}

function parseDocxVisual(
  entries: ReadonlyMap<string, PackageEntry>,
  structure: Awaited<ReturnType<typeof analyzeOoxmlBuffer>>,
  warnings: string[]
): VisualDocxLayout {
  const paragraphMap = new Map<string, DocxParagraphElement>();
  for (const element of structure.elements) {
    if (element.kind === "paragraph") paragraphMap.set(`${element.part}\u0000${element.index}`, element);
  }
  const styles = parseDocxStyles(xmlEntry(entries, "word/styles.xml"));
  const paragraphs: VisualDocxParagraph[] = [];
  const tables: VisualDocxTable[] = [];
  const mediaBudget = { used: 0 };
  const partNames = [...new Set([...paragraphMap.values()].map((item) => item.part))];

  for (const partName of partNames) {
    const root = xmlEntry(entries, partName);
    if (!root) continue;
    const rels = relationships(xmlEntry(entries, relationshipPart(partName)));
    let paragraphIndex = -1;
    let tableIndex = -1;

    const parseParagraph = (node: XmlNode): void => {
      paragraphIndex += 1;
      const element = paragraphMap.get(`${partName}\u0000${paragraphIndex}`);
      if (!element) return;
      const pPr = child(node, "pPr");
      const styleId = attr(child(pPr, "pStyle"), "val") ?? null;
      const inherited = resolveDocxStyle(styles, styleId);
      const paragraphStyle = mergeDefined(inherited.paragraph, paragraphStylePatch(pPr));
      const runStyles: VisualTextStyle[] = [];
      const images: VisualEmbeddedImage[] = [];
      for (const run of descendants(node, "r")) {
        const rStyleId = attr(child(child(run, "rPr"), "rStyle"), "val") ?? null;
        const baseRun = rStyleId
          ? mergeDefined(inherited.run, resolveDocxStyle(styles, rStyleId).run)
          : inherited.run;
        runStyles.push(mergeDefined(baseRun, runStylePatch(child(run, "rPr"))));
        for (const blip of descendants(run, "blip")) {
          const relationshipId = attr(blip, "embed");
          if (!relationshipId) continue;
          const extent = descendants(run, "extent").find((candidate) => attr(candidate, "cx") !== undefined);
          const docPr = descendants(run, "docPr")[0];
          const image = embeddedImage(
            entries,
            rels.get(relationshipId),
            partName,
            "word",
            relationshipId,
            emuToPt(attr(extent, "cx")),
            emuToPt(attr(extent, "cy")),
            attr(docPr, "descr") ?? attr(docPr, "title") ?? attr(docPr, "name") ?? "Встроенное изображение",
            null,
            mediaBudget,
            warnings
          );
          if (image) images.push(image);
        }
      }
      paragraphs.push({
        elementId: element.id,
        paragraphStyle,
        runs: runStyles,
        images
      });
    };

    const parseTable = (table: XmlNode): void => {
      tableIndex += 1;
      const tablePr = child(table, "tblPr");
      const grid = child(table, "tblGrid");
      const visualTable: VisualDocxTable = {
        part: partName,
        tableIndex,
        widthPt: twipsToPt(attr(child(tablePr, "tblW"), "w")),
        columnWidthsPt: children(grid, "gridCol").map((column) => twipsToPt(attr(column, "w")) ?? 0),
        cells: []
      };
      const rows = children(table, "tr");
      rows.forEach((row, rowIndex) => {
        children(row, "tc").forEach((cell, columnIndex) => {
          const tcPr = child(cell, "tcPr");
          const merge = child(tcPr, "vMerge");
          visualTable.cells.push({
            rowIndex,
            columnIndex,
            columnSpan: Math.max(1, Math.trunc(safeNumber(attr(child(tcPr, "gridSpan"), "val")) ?? 1)),
            verticalMerge: merge ? ((attr(merge, "val") ?? "continue") === "restart" ? "restart" : "continue") : null,
            style: docxCellStyle(tcPr)
          });
          for (const item of cell.children) {
            if (item.localName === "p") parseParagraph(item);
            else if (item.localName === "tbl") parseTable(item);
          }
        });
      });
      tables.push(visualTable);
    };

    const parseContainer = (node: XmlNode): void => {
      for (const item of node.children) {
        if (item.localName === "p") parseParagraph(item);
        else if (item.localName === "tbl") parseTable(item);
        else parseContainer(item);
      }
    };

    const container = partName === "word/document.xml"
      ? descendants(root, "body")[0] ?? root
      : root.children[0] ?? root;
    parseContainer(container);
  }

  return {
    page: parseDocxPage(xmlEntry(entries, "word/document.xml")),
    paragraphs,
    tables
  };
}

function excelColor(node: XmlNode | undefined): string | null {
  return normalizedHex(attr(node, "rgb"));
}

function parseXlsxStyles(root: XmlNode | null): {
  fonts: XlsxFont[];
  fills: XlsxFill[];
  borders: XlsxBorder[];
  formats: XlsxCellFormat[];
  numberFormats: Map<number, string>;
} {
  const styleSheet = root?.children.find((item) => item.localName === "styleSheet") ?? root?.children[0];
  const fonts = children(child(styleSheet, "fonts"), "font").map((font): XlsxFont => ({
    style: {
      ...emptyTextStyle(),
      bold: Boolean(child(font, "b")),
      italic: Boolean(child(font, "i")),
      underline: Boolean(child(font, "u")),
      strike: Boolean(child(font, "strike")),
      color: excelColor(child(font, "color")),
      fontFamily: attr(child(font, "name"), "val") ?? null,
      fontSizePt: safeNumber(attr(child(font, "sz"), "val")),
      verticalAlign: attr(child(font, "vertAlign"), "val") === "superscript"
        ? "superscript"
        : attr(child(font, "vertAlign"), "val") === "subscript"
          ? "subscript"
          : "baseline"
    }
  }));
  const fills = children(child(styleSheet, "fills"), "fill").map((fill): XlsxFill => ({
    color: excelColor(child(child(fill, "patternFill"), "fgColor"))
  }));
  const borders = children(child(styleSheet, "borders"), "border").map((border): XlsxBorder => ({
    value: {
      top: borderSide(child(border, "top")),
      right: borderSide(child(border, "right")),
      bottom: borderSide(child(border, "bottom")),
      left: borderSide(child(border, "left"))
    }
  }));
  const numberFormats = new Map<number, string>();
  for (const format of children(child(styleSheet, "numFmts"), "numFmt")) {
    const id = safeNumber(attr(format, "numFmtId"));
    const code = attr(format, "formatCode");
    if (id !== null && code) numberFormats.set(id, code);
  }
  const formats = children(child(styleSheet, "cellXfs"), "xf").map((format): XlsxCellFormat => {
    const alignment = child(format, "alignment");
    const horizontal = attr(alignment, "horizontal");
    const vertical = attr(alignment, "vertical");
    return {
      fontId: Math.max(0, Math.trunc(safeNumber(attr(format, "fontId")) ?? 0)),
      fillId: Math.max(0, Math.trunc(safeNumber(attr(format, "fillId")) ?? 0)),
      borderId: Math.max(0, Math.trunc(safeNumber(attr(format, "borderId")) ?? 0)),
      numFmtId: Math.max(0, Math.trunc(safeNumber(attr(format, "numFmtId")) ?? 0)),
      horizontalAlign: horizontal === "center" || horizontal === "right" || horizontal === "justify" || horizontal === "left" ? horizontal : null,
      verticalAlign: vertical === "center" || vertical === "bottom" || vertical === "top" ? vertical : null,
      wrapText: attr(alignment, "wrapText") === "1" || attr(alignment, "wrapText") === "true"
    };
  });
  return { fonts, fills, borders, formats, numberFormats };
}

function cellCoordinate(address: string): { row: number; column: number } | null {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(address.toUpperCase());
  if (!match) return null;
  let column = 0;
  for (const character of match[1] ?? "") column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]);
  return row >= 1 && column >= 1 ? { row, column } : null;
}

const BUILTIN_NUMBER_FORMATS: Readonly<Record<number, string>> = {
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  14: "dd.mm.yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  20: "h:mm",
  21: "h:mm:ss",
  22: "dd.mm.yyyy h:mm"
};

function excelDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const adjusted = serial >= 60 ? serial - 1 : serial;
  return new Date(Date.UTC(1899, 11, 31) + adjusted * 86_400_000);
}

function formattedCellValue(value: string, valueKind: XlsxCellElement["valueKind"], formatCode: string | null): string {
  if (valueKind !== "number" && valueKind !== "formula") return value;
  const number = Number(value);
  if (!Number.isFinite(number) || !formatCode) return value;
  if (/%/u.test(formatCode)) {
    const decimals = /0\.(0+)%/u.exec(formatCode)?.[1]?.length ?? 0;
    return `${(number * 100).toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
  }
  if (/[dmyhs]/iu.test(formatCode)) {
    const date = excelDate(number);
    if (date) {
      const hasTime = /[hs]/iu.test(formatCode);
      return new Intl.DateTimeFormat("ru-RU", {
        timeZone: "UTC",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {})
      }).format(date);
    }
  }
  const decimalMatch = /0\.(0+)/u.exec(formatCode);
  const decimals = decimalMatch?.[1]?.length;
  return decimals === undefined
    ? number.toLocaleString("ru-RU")
    : number.toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function excelHeaderFooter(value: string): { left: string; center: string; right: string } {
  const sections = { left: "", center: "", right: "" };
  let current: keyof typeof sections = "center";
  const parts = value.split(/(&[LCR])/u);
  for (const part of parts) {
    if (part === "&L") current = "left";
    else if (part === "&C") current = "center";
    else if (part === "&R") current = "right";
    else {
      sections[current] += part
        .replace(/&"[^"]*"/gu, "")
        .replace(/&K[0-9A-F]{6}/giu, "")
        .replace(/&[BIEUSXY]/gu, "")
        .replace(/&[0-9]+/gu, "")
        .replace(/&&/gu, "&");
    }
  }
  return sections;
}

function parseXlsxSheet(
  entries: ReadonlyMap<string, PackageEntry>,
  sheetName: string,
  sheetPath: string,
  elements: XlsxCellElement[],
  styleData: ReturnType<typeof parseXlsxStyles>,
  mediaBudget: { used: number },
  warnings: string[]
): VisualXlsxSheet {
  const root = xmlEntry(entries, sheetPath);
  const worksheet = root?.children.find((item) => item.localName === "worksheet") ?? root?.children[0];
  const elementMap = new Map(elements.map((element) => [element.address.toUpperCase(), element]));
  const columns: VisualXlsxSheet["columns"] = [];
  for (const col of children(child(worksheet, "cols"), "col")) {
    const min = Math.max(1, Math.trunc(safeNumber(attr(col, "min")) ?? 1));
    const max = Math.max(min, Math.trunc(safeNumber(attr(col, "max")) ?? min));
    const width = safeNumber(attr(col, "width")) ?? 8.43;
    for (let column = min; column <= Math.min(max, 16_384); column += 1) {
      columns.push({ column, widthChars: width, hidden: attr(col, "hidden") === "1" });
    }
  }
  const rows: VisualXlsxSheet["rows"] = [];
  const visualCells: VisualXlsxSheet["cells"] = [];
  for (const row of descendants(child(worksheet, "sheetData"), "row")) {
    const rowNumber = Math.max(1, Math.trunc(safeNumber(attr(row, "r")) ?? rows.length + 1));
    rows.push({
      row: rowNumber,
      heightPt: safeNumber(attr(row, "ht")),
      hidden: attr(row, "hidden") === "1"
    });
    for (const cell of children(row, "c")) {
      const address = (attr(cell, "r") ?? "").toUpperCase();
      const source = elementMap.get(address);
      const coordinate = cellCoordinate(address);
      if (!source || !coordinate) continue;
      const styleId = Math.max(0, Math.trunc(safeNumber(attr(cell, "s")) ?? 0));
      const format = styleData.formats[styleId] ?? {
        fontId: 0,
        fillId: 0,
        borderId: 0,
        numFmtId: 0,
        horizontalAlign: null,
        verticalAlign: null,
        wrapText: false
      };
      const formatCode = styleData.numberFormats.get(format.numFmtId) ?? BUILTIN_NUMBER_FORMATS[format.numFmtId] ?? null;
      visualCells.push({
        elementId: source.id,
        address,
        row: coordinate.row,
        column: coordinate.column,
        displayValue: formattedCellValue(source.value, source.valueKind, formatCode),
        style: {
          font: styleData.fonts[format.fontId]?.style ?? emptyTextStyle(),
          fillColor: styleData.fills[format.fillId]?.color ?? null,
          horizontalAlign: format.horizontalAlign,
          verticalAlign: format.verticalAlign,
          wrapText: format.wrapText,
          borders: styleData.borders[format.borderId]?.value ?? emptyBorders(),
          numberFormat: formatCode
        }
      });
    }
  }
  const merges = descendants(child(worksheet, "mergeCells"), "mergeCell")
    .map((merge) => attr(merge, "ref") ?? "")
    .filter(Boolean);
  const headerFooter = child(worksheet, "headerFooter");
  const header = excelHeaderFooter(nodeText(child(headerFooter, "oddHeader")));
  const footer = excelHeaderFooter(nodeText(child(headerFooter, "oddFooter")));
  const images: VisualEmbeddedImage[] = [];
  const sheetRels = relationships(xmlEntry(entries, relationshipPart(sheetPath)));
  for (const relation of sheetRels.values()) {
    if (relation.external || !relation.type.endsWith("/drawing")) continue;
    const drawingPath = safeRelationshipTarget(sheetPath, relation.target, "xl");
    if (!drawingPath) continue;
    const drawing = xmlEntry(entries, drawingPath);
    const drawingRels = relationships(xmlEntry(entries, relationshipPart(drawingPath)));
    for (const anchor of [...descendants(drawing ?? undefined, "twoCellAnchor"), ...descendants(drawing ?? undefined, "oneCellAnchor")]) {
      const blip = descendants(anchor, "blip")[0];
      const relationshipId = attr(blip, "embed");
      if (!relationshipId) continue;
      const from = child(anchor, "from");
      const row = Math.max(0, Math.trunc(safeNumber(nodeText(child(from, "row"))) ?? 0)) + 1;
      const column = Math.max(0, Math.trunc(safeNumber(nodeText(child(from, "col"))) ?? 0)) + 1;
      const extent = descendants(anchor, "ext").find((candidate) => attr(candidate, "cx") !== undefined);
      const properties = descendants(anchor, "cNvPr")[0];
      const image = embeddedImage(
        entries,
        drawingRels.get(relationshipId),
        drawingPath,
        "xl",
        relationshipId,
        emuToPt(attr(extent, "cx")),
        emuToPt(attr(extent, "cy")),
        attr(properties, "descr") ?? attr(properties, "name") ?? "Встроенное изображение",
        `R${row}C${column}`,
        mediaBudget,
        warnings
      );
      if (image) images.push(image);
    }
  }
  return { name: sheetName, path: sheetPath, columns, rows, merges, header, footer, cells: visualCells, images };
}

function parseXlsxVisual(
  entries: ReadonlyMap<string, PackageEntry>,
  structure: Awaited<ReturnType<typeof analyzeOoxmlBuffer>>,
  warnings: string[]
): VisualXlsxLayout {
  const styles = parseXlsxStyles(xmlEntry(entries, "xl/styles.xml"));
  const mediaBudget = { used: 0 };
  const grouped = new Map<string, XlsxCellElement[]>();
  for (const element of structure.elements) {
    if (element.kind !== "cell") continue;
    const key = `${element.sheetName}\u0000${element.sheetPath}`;
    const list = grouped.get(key) ?? [];
    list.push(element);
    grouped.set(key, list);
  }
  const sheets: VisualXlsxSheet[] = [];
  for (const [key, elements] of grouped) {
    const separator = key.indexOf("\u0000");
    sheets.push(
      parseXlsxSheet(
        entries,
        key.slice(0, separator),
        key.slice(separator + 1),
        elements,
        styles,
        mediaBudget,
        warnings
      )
    );
  }
  return { sheets };
}

function visualEntry(name: string): boolean {
  return (
    name === "word/document.xml" ||
    name === "word/styles.xml" ||
    /^word\/(header|footer)[0-9]+\.xml$/u.test(name) ||
    name === "word/footnotes.xml" ||
    name === "word/endnotes.xml" ||
    /^word\/_rels\/[^/]+\.xml\.rels$/u.test(name) ||
    /^word\/media\/[^/]+$/u.test(name) ||
    name === "xl/styles.xml" ||
    /^xl\/worksheets\/[^/]+\.xml$/u.test(name) ||
    /^xl\/worksheets\/_rels\/[^/]+\.xml\.rels$/u.test(name) ||
    /^xl\/drawings\/[^/]+\.xml$/u.test(name) ||
    /^xl\/drawings\/_rels\/[^/]+\.xml\.rels$/u.test(name) ||
    /^xl\/media\/[^/]+$/u.test(name)
  );
}

export async function analyzeOoxmlVisualLayout(
  input: AnalyzeVisualOoxmlInput
): Promise<DocumentVisualLayoutReport> {
  const intake = await inspectOoxmlBuffer(input);
  if (intake.decision === "rejected") {
    throw new DocumentIntakeError(
      "document_rejected",
      422,
      "Визуальное представление недоступно: исходный файл не прошёл безопасную проверку."
    );
  }
  const structure = await analyzeOoxmlBuffer({
    ...input,
    maxElements: 2_000
  });
  const entries = await collectPackageEntries(input.buffer, visualEntry);
  const warnings: string[] = [];
  if (intake.issues.some((issue) => issue.severity === "warning")) {
    warnings.push("В исходнике есть Office-конструкции, требующие обязательной проверки пробной копии.");
  }
  return {
    fileName: structure.fileName,
    format: structure.format,
    sourceSha256: structure.sourceSha256,
    warnings,
    docx: structure.format === "docx" ? parseDocxVisual(entries, structure, warnings) : null,
    xlsx: structure.format === "xlsx" ? parseXlsxVisual(entries, structure, warnings) : null
  };
}
