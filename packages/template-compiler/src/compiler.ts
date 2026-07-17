import { createHash } from "node:crypto";

import {
  analyzeOoxmlBuffer,
  type DocumentStructureElement
} from "@docomator/document-intake";

import {
  OoxmlPackageError,
  packageEntry,
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackageEntry
} from "./ooxml-package.js";

export interface DocxParagraphBinding {
  version: 1;
  kind: "docx.paragraph";
  elementId: string;
  part: string;
  index: number;
  tableLocation?: unknown;
}

export interface DocxTextRangeBinding {
  version: 1;
  kind: "docx.text-range";
  elementId: string;
  part: string;
  index: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  tableLocation?: unknown;
}

export interface XlsxCellBinding {
  version: 1;
  kind: "xlsx.cell";
  elementId: string;
  sheetName: string;
  sheetPath: string;
  address: string;
}

export type ScalarFieldBinding =
  | DocxParagraphBinding
  | DocxTextRangeBinding
  | XlsxCellBinding;

export interface CompileScalarFieldDefinition {
  id: string;
  key: string;
  label: string;
  elementId: string;
  binding: unknown;
}

export interface CompileScalarFieldInput {
  source: Uint8Array;
  fileName: string;
  expectedSourceSha256: string;
  expectedStructureSha256: string;
  field: CompileScalarFieldDefinition;
}

export interface CompiledTechnicalBinding {
  kind: "docx.sdt" | "xlsx.defined-name";
  identifier: string;
  part: string;
  target: string;
}

export interface CompileScalarFieldResult {
  output: Buffer;
  format: "docx" | "xlsx";
  sourceSha256: string;
  structureSha256: string;
  outputSha256: string;
  fieldId: string;
  fieldKey: string;
  modifiedPart: string;
  technicalBinding: CompiledTechnicalBinding;
  verification: {
    found: true;
    message: string;
  };
}

export class TemplateCompilerError extends Error {
  override readonly name = "TemplateCompilerError";

  constructor(
    readonly code: string,
    readonly userMessage: string
  ) {
    super(userMessage);
  }
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

interface XmlElementRange {
  start: number;
  end: number;
  openEnd: number;
  closeStart: number;
  name: string;
  selfClosing: boolean;
}

interface DecodedXml {
  text: string;
  encoding: "utf8" | "utf16le" | "utf16be";
  bom: boolean;
}

function sha256(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeExpectedSha256(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new TemplateCompilerError(
      "invalid_expected_sha256",
      `${label} имеет недопустимый формат.`
    );
  }
  return normalized;
}

function requiredText(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TemplateCompilerError(
      "invalid_field_definition",
      `Не заполнено обязательное значение «${label}».`
    );
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new TemplateCompilerError(
      "invalid_field_definition",
      `Значение «${label}» не должно быть длиннее ${maximum} знаков.`
    );
  }
  return normalized;
}

function exactText(value: unknown, label: string, maximum = 20_000): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TemplateCompilerError(
      "invalid_binding",
      `Не заполнено обязательное значение «${label}».`
    );
  }
  if (value.length > maximum || /\u0000/u.test(value)) {
    throw new TemplateCompilerError(
      "invalid_binding",
      `Значение «${label}» имеет недопустимый размер или содержит запрещённый знак.`
    );
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integerValue(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TemplateCompilerError(
      "invalid_binding",
      `Координата «${label}» имеет недопустимое значение.`
    );
  }
  return value as number;
}

function parseBinding(value: unknown): ScalarFieldBinding {
  if (!isObject(value) || value.version !== 1) {
    throw new TemplateCompilerError(
      "invalid_binding",
      "Сохранённая привязка поля имеет неподдерживаемую версию."
    );
  }
  const kind = value.kind;
  const elementId = requiredText(value.elementId, "идентификатор элемента", 160);
  if (kind === "docx.paragraph") {
    return {
      version: 1,
      kind,
      elementId,
      part: requiredText(value.part, "часть DOCX", 500),
      index: integerValue(value.index, "номер абзаца"),
      ...(value.tableLocation === undefined
        ? {}
        : { tableLocation: value.tableLocation })
    };
  }
  if (kind === "docx.text-range") {
    const startOffset = integerValue(value.startOffset, "начало текста");
    const endOffset = integerValue(value.endOffset, "конец текста");
    if (endOffset <= startOffset || endOffset > 20_000) {
      throw new TemplateCompilerError(
        "invalid_binding",
        "Сохранённые границы текста DOCX имеют недопустимое значение."
      );
    }
    return {
      version: 1,
      kind,
      elementId,
      part: requiredText(value.part, "часть DOCX", 500),
      index: integerValue(value.index, "номер абзаца"),
      startOffset,
      endOffset,
      selectedText: exactText(value.selectedText, "выбранный текст"),
      ...(value.tableLocation === undefined
        ? {}
        : { tableLocation: value.tableLocation })
    };
  }
  if (kind === "xlsx.cell") {
    const address = requiredText(value.address, "адрес ячейки", 32).toUpperCase();
    if (!/^[A-Z]{1,4}[1-9][0-9]{0,6}$/u.test(address)) {
      throw new TemplateCompilerError(
        "invalid_binding",
        "Сохранённый адрес ячейки XLSX имеет недопустимый формат."
      );
    }
    return {
      version: 1,
      kind,
      elementId,
      sheetName: requiredText(value.sheetName, "название листа", 255),
      sheetPath: requiredText(value.sheetPath, "часть листа", 500),
      address
    };
  }
  throw new TemplateCompilerError(
    "unsupported_binding",
    "Компилятор поддерживает целый абзац или выбранный текст DOCX и одну ячейку XLSX."
  );
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

function scanXmlTags(xml: string): XmlTag[] {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new TemplateCompilerError(
      "unsafe_xml_declaration",
      "Документ содержит запрещённое объявление XML и не может быть скомпилирован."
    );
  }
  const tags: XmlTag[] = [];
  let index = 0;
  while (index < xml.length) {
    const opening = xml.indexOf("<", index);
    if (opening < 0) break;
    if (xml.startsWith("<!--", opening)) {
      const closing = xml.indexOf("-->", opening + 4);
      if (closing < 0) throwInvalidXml();
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<?", opening)) {
      const closing = xml.indexOf("?>", opening + 2);
      if (closing < 0) throwInvalidXml();
      index = closing + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", opening)) {
      const closing = xml.indexOf("]]>", opening + 9);
      if (closing < 0) throwInvalidXml();
      index = closing + 3;
      continue;
    }
    if (xml.startsWith("<!", opening)) {
      throw new TemplateCompilerError(
        "unsafe_xml_declaration",
        "Документ содержит неподдерживаемое объявление XML."
      );
    }
    const closingIndex = findTagEnd(xml, opening + 1);
    if (closingIndex < 0) throwInvalidXml();
    const raw = xml.slice(opening + 1, closingIndex).trim();
    const closing = raw.startsWith("/");
    const selfClosing = !closing && raw.endsWith("/");
    const source = closing
      ? raw.slice(1).trim()
      : selfClosing
        ? raw.slice(0, -1).trimEnd()
        : raw;
    const name = source.split(/\s/u, 1)[0] ?? "";
    if (name.length === 0) throwInvalidXml();
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

function throwInvalidXml(): never {
  throw new TemplateCompilerError(
    "invalid_xml",
    "Одна из XML-частей документа повреждена."
  );
}

function findElementRange(
  xml: string,
  wantedLocalName: string,
  wantedIndex: number
): XmlElementRange {
  const tags = scanXmlTags(xml);
  let currentIndex = -1;
  for (let position = 0; position < tags.length; position += 1) {
    const tag = tags[position];
    if (tag === undefined || tag.closing || tag.localName !== wantedLocalName) continue;
    currentIndex += 1;
    if (currentIndex !== wantedIndex) continue;
    if (tag.selfClosing) {
      return {
        start: tag.start,
        end: tag.end,
        openEnd: tag.end,
        closeStart: tag.end,
        name: tag.name,
        selfClosing: true
      };
    }
    let depth = 1;
    for (let nestedPosition = position + 1; nestedPosition < tags.length; nestedPosition += 1) {
      const nested = tags[nestedPosition];
      if (nested === undefined || nested.name !== tag.name) continue;
      if (!nested.closing && !nested.selfClosing) depth += 1;
      else if (nested.closing) depth -= 1;
      if (depth === 0) {
        return {
          start: tag.start,
          end: nested.end,
          openEnd: tag.end,
          closeStart: nested.start,
          name: tag.name,
          selfClosing: false
        };
      }
    }
    break;
  }
  throw new TemplateCompilerError(
    "binding_target_not_found",
    `Элемент «${wantedLocalName}» с номером ${wantedIndex + 1} не найден в сохранённой части.`
  );
}

function findFirstElement(xml: string, wantedLocalName: string): XmlElementRange | null {
  try {
    return findElementRange(xml, wantedLocalName, 0);
  } catch (error) {
    if (
      error instanceof TemplateCompilerError &&
      error.code === "binding_target_not_found"
    ) {
      return null;
    }
    throw error;
  }
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

function tagPrefix(qualifiedName: string): string {
  const separator = qualifiedName.lastIndexOf(":");
  return separator < 0 ? "" : `${qualifiedName.slice(0, separator)}:`;
}

function deterministicWordId(fieldId: string): number {
  const raw = createHash("sha256").update(fieldId).digest().readUInt32BE(0);
  const positive = raw & 0x7fffffff;
  return positive === 0 ? 1 : positive;
}

function technicalTag(fieldId: string): string {
  return `aifield:${fieldId}`;
}

function technicalDefinedName(fieldId: string): string {
  const suffix = createHash("sha256")
    .update(fieldId)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
  return `_DOCOMATOR_${suffix}`;
}

function ensureStructureElement(
  elements: readonly DocumentStructureElement[],
  elementId: string
): DocumentStructureElement {
  const element = elements.find((candidate) => candidate.id === elementId);
  if (element === undefined) {
    throw new TemplateCompilerError(
      "structure_element_not_found",
      "Сохранённый элемент не найден в текущей структуре исходника."
    );
  }
  return element;
}

function replacePackageEntry(
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
    throw new TemplateCompilerError(
      "binding_part_not_found",
      `В пакете не найдена часть «${name}».`
    );
  }
  return result;
}

interface DocxTextRun {
  start: number;
  end: number;
  name: string;
  opening: string;
  closing: string;
  properties: string;
  text: string;
  textStart: number;
  textEnd: number;
  safe: boolean;
}

function matchingCloseIndex(tags: readonly XmlTag[], openingIndex: number): number {
  const opening = tags[openingIndex];
  if (opening === undefined || opening.closing) throwInvalidXml();
  if (opening.selfClosing) return openingIndex;
  let depth = 1;
  for (let index = openingIndex + 1; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag === undefined || tag.name !== opening.name) continue;
    if (!tag.closing && !tag.selfClosing) depth += 1;
    else if (tag.closing) depth -= 1;
    if (depth === 0) return index;
  }
  throwInvalidXml();
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
          "В документе обнаружена недопустимая XML-сущность."
        );
      }
      return String.fromCodePoint(codePoint);
    }
  );
}

function collectDocxTextRuns(xml: string): DocxTextRun[] {
  const tags = scanXmlTags(xml);
  const ranges = new Map<number, number>();
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag !== undefined && !tag.closing) {
      ranges.set(index, matchingCloseIndex(tags, index));
    }
  }
  const hasParentBetween = (
    outerOpen: number,
    outerClose: number,
    childOpen: number,
    childClose: number
  ): boolean =>
    [...ranges].some(
      ([open, close]) =>
        open > outerOpen &&
        close < outerClose &&
        open < childOpen &&
        close > childClose
    );
  const runs: DocxTextRun[] = [];
  let textOffset = 0;
  for (let index = 0; index < tags.length; index += 1) {
    const run = tags[index];
    if (
      run === undefined ||
      run.closing ||
      run.selfClosing ||
      run.localName !== "r"
    ) {
      continue;
    }
    const closeIndex = ranges.get(index);
    const close = closeIndex === undefined ? undefined : tags[closeIndex];
    if (closeIndex === undefined || close === undefined) throwInvalidXml();
    const directRun = ![...ranges].some(
      ([open, rangeClose]) => open < index && rangeClose > closeIndex
    );
    const directChildren: Array<{ open: number; close: number; tag: XmlTag }> = [];
    for (let childIndex = index + 1; childIndex < closeIndex; childIndex += 1) {
      const child = tags[childIndex];
      const childClose = ranges.get(childIndex);
      if (
        child === undefined ||
        child.closing ||
        childClose === undefined ||
        hasParentBetween(index, closeIndex, childIndex, childClose)
      ) {
        continue;
      }
      directChildren.push({ open: childIndex, close: childClose, tag: child });
    }
    const properties = directChildren.filter(
      ({ tag }) => tag.localName === "rPr"
    );
    const texts = directChildren.filter(({ tag }) => tag.localName === "t");
    const allowedDirectChildren = directChildren.every(
      ({ tag }) => tag.localName === "rPr" || tag.localName === "t"
    );
    const text = texts
      .map(({ tag, close: textCloseIndex }) => {
        const textClose = tags[textCloseIndex];
        if (tag.selfClosing) return "";
        if (textClose === undefined) throwInvalidXml();
        return decodeXmlText(xml.slice(tag.end, textClose.start));
      })
      .join("");
    const property = properties[0];
    const propertyClose = property === undefined ? undefined : tags[property.close];
    const propertyXml =
      property === undefined
        ? ""
        : property.tag.selfClosing
          ? xml.slice(property.tag.start, property.tag.end)
          : propertyClose === undefined
            ? throwInvalidXml()
            : xml.slice(property.tag.start, propertyClose.end);
    runs.push({
      start: run.start,
      end: close.end,
      name: run.name,
      opening: xml.slice(run.start, run.end),
      closing: xml.slice(close.start, close.end),
      properties: propertyXml,
      text,
      textStart: textOffset,
      textEnd: textOffset + text.length,
      safe:
        directRun &&
        properties.length <= 1 &&
        texts.length > 0 &&
        allowedDirectChildren
    });
    textOffset += text.length;
  }
  return runs;
}

function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  return !(
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff
  );
}

function textRunXml(run: DocxTextRun, text: string): string {
  if (text.length === 0) return "";
  const prefix = tagPrefix(run.name);
  return `${run.opening}${run.properties}<${prefix}t xml:space="preserve">${xmlText(text)}</${prefix}t>${run.closing}`;
}

function compileDocxParagraph(
  entries: readonly OoxmlPackageEntry[],
  binding: DocxParagraphBinding,
  field: CompileScalarFieldDefinition
): {
  entries: OoxmlPackageEntry[];
  technicalBinding: CompiledTechnicalBinding;
} {
  const target = packageEntry(entries, binding.part);
  const decoded = decodeXml(target.content);
  const tagValue = technicalTag(field.id);
  if (decoded.text.includes(xmlAttribute(tagValue))) {
    throw new TemplateCompilerError(
      "binding_already_exists",
      "Техническая привязка этого поля уже существует в документе."
    );
  }
  const paragraph = findElementRange(decoded.text, "p", binding.index);
  const original = decoded.text.slice(paragraph.start, paragraph.end);
  const prefix = tagPrefix(paragraph.name) || "w:";
  const namespace =
    tagPrefix(paragraph.name).length === 0
      ? ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
      : "";
  const alias = xmlAttribute(field.label);
  const escapedTag = xmlAttribute(tagValue);
  const wrapper = `<${prefix}sdt${namespace}><${prefix}sdtPr><${prefix}alias ${prefix}val="${alias}"/><${prefix}tag ${prefix}val="${escapedTag}"/><${prefix}id ${prefix}val="${deterministicWordId(field.id)}"/></${prefix}sdtPr><${prefix}sdtContent>${original}</${prefix}sdtContent></${prefix}sdt>`;
  const updated =
    decoded.text.slice(0, paragraph.start) +
    wrapper +
    decoded.text.slice(paragraph.end);
  return {
    entries: replacePackageEntry(
      entries,
      binding.part,
      encodeXml(decoded, updated)
    ),
    technicalBinding: {
      kind: "docx.sdt",
      identifier: tagValue,
      part: binding.part,
      target: `абзац ${binding.index + 1}`
    }
  };
}

function compileDocxTextRange(
  entries: readonly OoxmlPackageEntry[],
  binding: DocxTextRangeBinding,
  field: CompileScalarFieldDefinition
): {
  entries: OoxmlPackageEntry[];
  technicalBinding: CompiledTechnicalBinding;
} {
  const target = packageEntry(entries, binding.part);
  const decoded = decodeXml(target.content);
  const tagValue = technicalTag(field.id);
  if (decoded.text.includes(xmlAttribute(tagValue))) {
    throw new TemplateCompilerError(
      "binding_already_exists",
      "Техническая привязка этого поля уже существует в документе."
    );
  }
  const paragraph = findElementRange(decoded.text, "p", binding.index);
  if (paragraph.selfClosing) {
    throw new TemplateCompilerError(
      "text_range_not_found",
      "Выбранный текст не найден в пустом абзаце DOCX."
    );
  }
  const paragraphContent = decoded.text.slice(
    paragraph.openEnd,
    paragraph.closeStart
  );
  const runs = collectDocxTextRuns(paragraphContent);
  const fullText = runs.map((run) => run.text).join("");
  if (
    binding.endOffset > fullText.length ||
    !isUtf16Boundary(fullText, binding.startOffset) ||
    !isUtf16Boundary(fullText, binding.endOffset) ||
    fullText.slice(binding.startOffset, binding.endOffset) !== binding.selectedText
  ) {
    throw new TemplateCompilerError(
      "text_range_mismatch",
      "Выбранный текст изменился или его границы не совпадают с сохранённым абзацем. Повторите разметку."
    );
  }
  const selectedRuns = runs.filter(
    (run) =>
      binding.startOffset < run.textEnd && binding.endOffset > run.textStart
  );
  if (selectedRuns.length === 0) {
    throw new TemplateCompilerError(
      "text_range_not_found",
      "Выбранный фрагмент текста DOCX не найден."
    );
  }
  if (selectedRuns.some((run) => !run.safe)) {
    throw new TemplateCompilerError(
      "unsupported_text_range",
      "Выбранный текст пересекает гиперссылку, поле, рисунок, разрыв или другой сложный объект DOCX. Выберите обычный текстовый фрагмент."
    );
  }
  const runProperties = selectedRuns[0]?.properties ?? "";
  if (selectedRuns.some((run) => run.properties !== runProperties)) {
    throw new TemplateCompilerError(
      "mixed_text_range_formatting",
      "Выбранный текст использует разное оформление. Выберите фрагмент с единым оформлением."
    );
  }
  for (let index = 1; index < selectedRuns.length; index += 1) {
    const previous = selectedRuns[index - 1];
    const current = selectedRuns[index];
    if (
      previous === undefined ||
      current === undefined ||
      !/^\s*$/u.test(paragraphContent.slice(previous.end, current.start))
    ) {
      throw new TemplateCompilerError(
        "unsupported_text_range",
        "Между выбранными текстовыми фрагментами находится сложный объект DOCX. Выберите непрерывный обычный текст."
      );
    }
  }
  const first = selectedRuns[0];
  const last = selectedRuns.at(-1);
  if (first === undefined || last === undefined) throwInvalidXml();
  const selectedXml = selectedRuns
    .map((run) => {
      const start = Math.max(binding.startOffset, run.textStart) - run.textStart;
      const end = Math.min(binding.endOffset, run.textEnd) - run.textStart;
      return textRunXml(run, run.text.slice(start, end));
    })
    .join("");
  const prefixText = first.text.slice(
    0,
    Math.max(0, binding.startOffset - first.textStart)
  );
  const suffixText = last.text.slice(
    Math.min(last.text.length, binding.endOffset - last.textStart)
  );
  const prefix = tagPrefix(paragraph.name) || "w:";
  const namespace =
    tagPrefix(paragraph.name).length === 0
      ? ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
      : "";
  const wrapper = `<${prefix}sdt${namespace}><${prefix}sdtPr><${prefix}alias ${prefix}val="${xmlAttribute(field.label)}"/><${prefix}tag ${prefix}val="${xmlAttribute(tagValue)}"/><${prefix}id ${prefix}val="${deterministicWordId(field.id)}"/></${prefix}sdtPr><${prefix}sdtContent>${selectedXml}</${prefix}sdtContent></${prefix}sdt>`;
  const replacement = `${textRunXml(first, prefixText)}${wrapper}${textRunXml(last, suffixText)}`;
  const replaceStart = paragraph.openEnd + first.start;
  const replaceEnd = paragraph.openEnd + last.end;
  const updated =
    decoded.text.slice(0, replaceStart) +
    replacement +
    decoded.text.slice(replaceEnd);
  return {
    entries: replacePackageEntry(
      entries,
      binding.part,
      encodeXml(decoded, updated)
    ),
    technicalBinding: {
      kind: "docx.sdt",
      identifier: tagValue,
      part: binding.part,
      target: `абзац ${binding.index + 1}, знаки ${binding.startOffset + 1}–${binding.endOffset}`
    }
  };
}

function absoluteAddress(address: string): string {
  const match = /^([A-Z]{1,4})([1-9][0-9]{0,6})$/u.exec(address);
  if (match === null) {
    throw new TemplateCompilerError(
      "invalid_cell_address",
      "Сохранённый адрес ячейки XLSX имеет недопустимый формат."
    );
  }
  return `$${match[1]}$${match[2]}`;
}

function quotedSheetName(name: string): string {
  return `'${name.replaceAll("'", "''")}'`;
}

function attributeValue(rawTag: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const expression = new RegExp(
    `(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`,
    "u"
  );
  return expression.exec(rawTag)?.[2] ?? null;
}

function hasDefinedName(xml: string, name: string): boolean {
  return scanXmlTags(xml).some(
    (tag) =>
      !tag.closing &&
      tag.localName === "definedName" &&
      attributeValue(tag.raw, "name") === name
  );
}

function compileXlsx(
  entries: readonly OoxmlPackageEntry[],
  binding: XlsxCellBinding,
  field: CompileScalarFieldDefinition
): {
  entries: OoxmlPackageEntry[];
  technicalBinding: CompiledTechnicalBinding;
} {
  const workbookPart = "xl/workbook.xml";
  const workbookEntry = packageEntry(entries, workbookPart);
  const decoded = decodeXml(workbookEntry.content);
  const name = technicalDefinedName(field.id);
  if (hasDefinedName(decoded.text, name)) {
    throw new TemplateCompilerError(
      "binding_already_exists",
      "Техническая привязка этого поля уже существует в книге."
    );
  }
  const workbook = findFirstElement(decoded.text, "workbook");
  if (workbook === null) {
    throw new TemplateCompilerError(
      "workbook_not_found",
      "В XLSX не найдена основная часть книги."
    );
  }
  const prefix = tagPrefix(workbook.name);
  const reference = `${quotedSheetName(binding.sheetName)}!${absoluteAddress(binding.address)}`;
  const node = `<${prefix}definedName name="${xmlAttribute(name)}">${xmlText(reference)}</${prefix}definedName>`;
  const definedNames = findFirstElement(decoded.text, "definedNames");
  let updated: string;
  if (definedNames !== null) {
    if (definedNames.selfClosing) {
      updated =
        decoded.text.slice(0, definedNames.start) +
        `<${prefix}definedNames>${node}</${prefix}definedNames>` +
        decoded.text.slice(definedNames.end);
    } else {
      updated =
        decoded.text.slice(0, definedNames.closeStart) +
        node +
        decoded.text.slice(definedNames.closeStart);
    }
  } else {
    const anchor =
      findFirstElement(decoded.text, "externalReferences") ??
      findFirstElement(decoded.text, "functionGroups") ??
      findFirstElement(decoded.text, "sheets");
    if (anchor === null) {
      throw new TemplateCompilerError(
        "workbook_anchor_not_found",
        "В книге не найдено место для именованной привязки."
      );
    }
    updated =
      decoded.text.slice(0, anchor.end) +
      `<${prefix}definedNames>${node}</${prefix}definedNames>` +
      decoded.text.slice(anchor.end);
  }
  return {
    entries: replacePackageEntry(
      entries,
      workbookPart,
      encodeXml(decoded, updated)
    ),
    technicalBinding: {
      kind: "xlsx.defined-name",
      identifier: name,
      part: workbookPart,
      target: reference
    }
  };
}

async function verifyTechnicalBinding(
  output: Buffer,
  binding: CompiledTechnicalBinding,
  sourceBinding: ScalarFieldBinding
): Promise<void> {
  const entries = await readOoxmlPackage(output);
  const target = packageEntry(entries, binding.part);
  const text = decodeXml(target.content).text;
  if (binding.kind === "docx.sdt") {
    const tags = scanXmlTags(text);
    let readBack: string | null = null;
    for (let index = 0; index < tags.length; index += 1) {
      const sdt = tags[index];
      if (
        sdt === undefined ||
        sdt.closing ||
        sdt.selfClosing ||
        sdt.localName !== "sdt"
      ) {
        continue;
      }
      const sdtCloseIndex = matchingCloseIndex(tags, index);
      const sdtClose = tags[sdtCloseIndex];
      if (sdtClose === undefined) throwInvalidXml();
      const inside = tags
        .map((tag, tagIndex) => ({ tag, tagIndex }))
        .filter(
          ({ tag }) => tag.start >= sdt.end && tag.end <= sdtClose.start
        );
      const identifierFound = inside.some(
        ({ tag }) =>
          !tag.closing &&
          tag.localName === "tag" &&
          (attributeValue(tag.raw, "w:val") ??
            attributeValue(tag.raw, "val")) === binding.identifier
      );
      if (!identifierFound) continue;
      const content = inside.find(
        ({ tag }) => !tag.closing && tag.localName === "sdtContent"
      );
      if (content === undefined) break;
      const contentCloseIndex = matchingCloseIndex(tags, content.tagIndex);
      const contentClose = tags[contentCloseIndex];
      if (contentClose === undefined) throwInvalidXml();
      readBack = inside
        .filter(
          ({ tag }) =>
            !tag.closing &&
            tag.localName === "t" &&
            tag.start >= content.tag.end &&
            tag.end <= contentClose.start
        )
        .map(({ tag, tagIndex }) => {
          if (tag.selfClosing) return "";
          const close = tags[matchingCloseIndex(tags, tagIndex)];
          if (close === undefined) throwInvalidXml();
          return decodeXmlText(text.slice(tag.end, close.start));
        })
        .join("");
      break;
    }
    if (readBack === null) {
      throw new TemplateCompilerError(
        "compiled_binding_not_found",
        "После сборки не удалось повторно найти техническую привязку DOCX."
      );
    }
    if (
      sourceBinding.kind === "docx.text-range" &&
      readBack !== sourceBinding.selectedText
    ) {
      throw new TemplateCompilerError(
        "compiled_text_range_mismatch",
        "После сборки выбранный текст DOCX не совпал с сохранённым фрагментом."
      );
    }
    return;
  }
  if (!hasDefinedName(text, binding.identifier)) {
    throw new TemplateCompilerError(
      "compiled_binding_not_found",
      "После сборки не удалось повторно найти именованную привязку XLSX."
    );
  }
}

export async function compileScalarField(
  input: CompileScalarFieldInput
): Promise<CompileScalarFieldResult> {
  const source = Buffer.from(input.source);
  const field: CompileScalarFieldDefinition = {
    id: requiredText(input.field.id, "идентификатор поля", 160),
    key: requiredText(input.field.key, "ключ поля", 160),
    label: requiredText(input.field.label, "название поля", 500),
    elementId: requiredText(input.field.elementId, "идентификатор элемента", 160),
    binding: input.field.binding
  };
  const expectedSourceSha256 = normalizeExpectedSha256(
    input.expectedSourceSha256,
    "Контрольная сумма исходника"
  );
  const expectedStructureSha256 = normalizeExpectedSha256(
    input.expectedStructureSha256,
    "Контрольная сумма структуры"
  );
  const actualSourceSha256 = sha256(source);
  if (actualSourceSha256 !== expectedSourceSha256) {
    throw new TemplateCompilerError(
      "source_checksum_mismatch",
      "Исходный файл изменился после разметки. Повторите проверку и создание черновика."
    );
  }
  const analysis = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: input.fileName,
    maxElements: 2_000
  });
  if (analysis.structureSha256 !== expectedStructureSha256) {
    throw new TemplateCompilerError(
      "structure_checksum_mismatch",
      "Структура исходника изменилась после сохранения поля. Повторите разметку."
    );
  }
  const binding = parseBinding(field.binding);
  if (binding.elementId !== field.elementId) {
    throw new TemplateCompilerError(
      "binding_element_mismatch",
      "Идентификатор поля не совпадает с сохранённой привязкой."
    );
  }
  const element = ensureStructureElement(analysis.elements, field.elementId);
  if (
    (binding.kind === "docx.paragraph" || binding.kind === "docx.text-range") &&
    (analysis.format !== "docx" ||
      element.kind !== "paragraph" ||
      element.part !== binding.part ||
      element.index !== binding.index)
  ) {
    throw new TemplateCompilerError(
      "binding_coordinate_mismatch",
      "Координата абзаца не совпадает с текущей структурой DOCX."
    );
  }
  if (
    binding.kind === "xlsx.cell" &&
    (analysis.format !== "xlsx" ||
      element.kind !== "cell" ||
      element.sheetName !== binding.sheetName ||
      element.sheetPath !== binding.sheetPath ||
      element.address !== binding.address)
  ) {
    throw new TemplateCompilerError(
      "binding_coordinate_mismatch",
      "Координата ячейки не совпадает с текущей структурой XLSX."
    );
  }

  let entries: OoxmlPackageEntry[];
  try {
    entries = await readOoxmlPackage(source);
  } catch (error) {
    if (error instanceof OoxmlPackageError) {
      throw new TemplateCompilerError(error.code, error.message);
    }
    throw error;
  }
  const compiled =
    binding.kind === "docx.paragraph"
      ? compileDocxParagraph(entries, binding, field)
      : binding.kind === "docx.text-range"
        ? compileDocxTextRange(entries, binding, field)
        : compileXlsx(entries, binding, field);
  const output = writeOoxmlPackage(compiled.entries);
  await verifyTechnicalBinding(output, compiled.technicalBinding, binding);

  return {
    output,
    format: analysis.format,
    sourceSha256: actualSourceSha256,
    structureSha256: analysis.structureSha256,
    outputSha256: sha256(output),
    fieldId: field.id,
    fieldKey: field.key,
    modifiedPart: compiled.technicalBinding.part,
    technicalBinding: compiled.technicalBinding,
    verification: {
      found: true,
      message: "Техническая привязка повторно найдена после сборки пакета."
    }
  };
}
