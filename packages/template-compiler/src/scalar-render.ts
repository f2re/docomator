import { createHash } from "node:crypto";

import {
  TemplateCompilerError,
  type CompiledTechnicalBinding,
  type ScalarFieldBinding
} from "./compiler.js";
import {
  packageEntry,
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackageEntry
} from "./ooxml-package.js";

export type ScalarValueType =
  | "string"
  | "text"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "date-time";

export interface RenderScalarValueInput {
  compiled: Uint8Array;
  technicalBinding: CompiledTechnicalBinding;
  fieldBinding: ScalarFieldBinding;
  valueType: ScalarValueType;
  value: unknown;
}

export interface ReadScalarValueInput {
  document: Uint8Array;
  technicalBinding: CompiledTechnicalBinding;
  fieldBinding: ScalarFieldBinding;
  valueType: ScalarValueType;
}

export interface ReadScalarValueResult {
  value: string;
  part: string;
  target: string;
}

export interface RenderScalarValueResult {
  output: Buffer;
  inputSha256: string;
  outputSha256: string;
  renderedValue: string;
  readBackValue: string;
  modifiedPart: string;
  verification: {
    matched: true;
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

interface NormalizedScalarValue {
  display: string;
  xlsxMode: "inline-string" | "number" | "boolean";
  xlsxValue: string;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new TemplateCompilerError(
      "invalid_trial_value",
      `Значение «${label}» должно содержать текст.`
    );
  }
  if (value.length > maximum) {
    throw new TemplateCompilerError(
      "trial_value_too_long",
      `Значение «${label}» не должно быть длиннее ${maximum} знаков.`
    );
  }
  if (/\u0000/u.test(value)) {
    throw new TemplateCompilerError(
      "invalid_trial_value",
      `Значение «${label}» содержит недопустимый управляющий знак.`
    );
  }
  return value;
}

function normalizeNumber(value: unknown, integer: boolean): string {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value.trim().replace(",", "."))
        : Number.NaN;
  if (!Number.isFinite(numberValue)) {
    throw new TemplateCompilerError(
      "invalid_trial_value",
      integer
        ? "Пробное значение должно быть целым числом."
        : "Пробное значение должно быть конечным числом."
    );
  }
  if (integer && !Number.isInteger(numberValue)) {
    throw new TemplateCompilerError(
      "invalid_trial_value",
      "Пробное значение должно быть целым числом."
    );
  }
  return Object.is(numberValue, -0) ? "0" : String(numberValue);
}

function normalizeDate(value: unknown): string {
  const text = requiredText(value, "пробная дата", 32).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (match === null) {
    throw new TemplateCompilerError(
      "invalid_trial_value",
      "Пробная дата должна иметь формат ГГГГ-ММ-ДД."
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TemplateCompilerError(
      "invalid_trial_value",
      "Указана несуществующая календарная дата."
    );
  }
  return text;
}

function normalizeDateTime(value: unknown): string {
  const text = requiredText(value, "пробные дата и время", 80).trim();
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new TemplateCompilerError(
      "invalid_trial_value",
      "Указаны недопустимые дата и время."
    );
  }
  return date.toISOString();
}

function normalizeScalarValue(
  valueType: ScalarValueType,
  value: unknown
): NormalizedScalarValue {
  if (valueType === "string") {
    const text = requiredText(value, "пробное значение", 4_000);
    return { display: text, xlsxMode: "inline-string", xlsxValue: text };
  }
  if (valueType === "text") {
    const text = requiredText(value, "пробное значение", 20_000);
    return { display: text, xlsxMode: "inline-string", xlsxValue: text };
  }
  if (valueType === "number" || valueType === "integer") {
    const number = normalizeNumber(value, valueType === "integer");
    return { display: number, xlsxMode: "number", xlsxValue: number };
  }
  if (valueType === "boolean") {
    if (typeof value !== "boolean") {
      throw new TemplateCompilerError(
        "invalid_trial_value",
        "Пробное логическое значение должно быть «да» или «нет»."
      );
    }
    return {
      display: value ? "Да" : "Нет",
      xlsxMode: "boolean",
      xlsxValue: value ? "1" : "0"
    };
  }
  if (valueType === "date") {
    const text = normalizeDate(value);
    return { display: text, xlsxMode: "inline-string", xlsxValue: text };
  }
  if (valueType === "date-time") {
    const text = normalizeDateTime(value);
    return { display: text, xlsxMode: "inline-string", xlsxValue: text };
  }
  throw new TemplateCompilerError(
    "unsupported_trial_value_type",
    "Тип пробного значения пока не поддерживается."
  );
}

function validateBindings(
  technical: CompiledTechnicalBinding,
  field: ScalarFieldBinding
): void {
  if (technical.kind === "docx.sdt") {
    if (field.kind !== "docx.paragraph") {
      throw new TemplateCompilerError(
        "technical_binding_mismatch",
        "Техническая привязка не соответствует сохранённой координате поля."
      );
    }
    if (technical.part !== field.part) {
      throw new TemplateCompilerError(
        "technical_binding_mismatch",
        "Техническая привязка указывает на другую часть DOCX."
      );
    }
    return;
  }
  if (field.kind !== "xlsx.cell") {
    throw new TemplateCompilerError(
      "technical_binding_mismatch",
      "Техническая привязка не соответствует сохранённой координате поля."
    );
  }
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
      "Документ содержит запрещённое объявление XML."
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

function attributeValue(rawTag: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const expression = new RegExp(
    `(?:^|\\s)${escapedName}\\s*=\\s*(["'])(.*?)\\1`,
    "u"
  );
  return expression.exec(rawTag)?.[2] ?? null;
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

function tagsInside(
  tags: readonly XmlTag[],
  start: number,
  end: number
): Array<{ tag: XmlTag; index: number }> {
  const result: Array<{ tag: XmlTag; index: number }> = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag !== undefined && tag.start >= start && tag.end <= end) {
      result.push({ tag, index });
    }
  }
  return result;
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
          "В документе обнаружена недопустимая XML-сущность."
        );
      }
      return String.fromCodePoint(codePoint);
    }
  );
}

function collectTextElements(xml: string, start: number, end: number): string {
  const fragment = xml.slice(start, end);
  const expression = /<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/gu;
  const values: string[] = [];
  for (const match of fragment.matchAll(expression)) {
    values.push(decodeXmlText(match[1] ?? ""));
  }
  return values.join("");
}

function replacePackageEntry(
  entries: readonly OoxmlPackageEntry[],
  name: string,
  content: Buffer
): OoxmlPackageEntry[] {
  let found = false;
  const updated = entries.map((entry) => {
    if (entry.name !== name) return entry;
    found = true;
    return { ...entry, content };
  });
  if (!found) {
    throw new TemplateCompilerError(
      "compiled_part_not_found",
      `В скомпилированном документе не найдена часть «${name}».`
    );
  }
  return updated;
}

function docxContentTarget(
  xml: string,
  identifier: string
): {
  tags: XmlTag[];
  sdtOpenIndex: number;
  sdtCloseIndex: number;
  contentOpenIndex: number;
  contentCloseIndex: number;
  paragraphOpenIndex: number;
  paragraphCloseIndex: number;
} {
  const tags = scanXmlTags(xml);
  for (let sdtIndex = 0; sdtIndex < tags.length; sdtIndex += 1) {
    const sdt = tags[sdtIndex];
    if (
      sdt === undefined ||
      sdt.closing ||
      sdt.selfClosing ||
      sdt.localName !== "sdt"
    ) {
      continue;
    }
    const sdtCloseIndex = matchingCloseIndex(tags, sdtIndex);
    const sdtClose = tags[sdtCloseIndex];
    if (sdtClose === undefined) throwInvalidXml();
    const inside = tagsInside(tags, sdt.end, sdtClose.start);
    const identifierFound = inside.some(
      ({ tag }) =>
        !tag.closing &&
        tag.localName === "tag" &&
        (attributeValue(tag.raw, "w:val") ??
          attributeValue(tag.raw, "val")) === identifier
    );
    if (!identifierFound) continue;
    const content = inside.find(
      ({ tag }) => !tag.closing && tag.localName === "sdtContent"
    );
    if (content === undefined) {
      throw new TemplateCompilerError(
        "sdt_content_not_found",
        "В технической привязке DOCX отсутствует содержимое."
      );
    }
    const contentCloseIndex = matchingCloseIndex(tags, content.index);
    const contentClose = tags[contentCloseIndex];
    if (contentClose === undefined) throwInvalidXml();
    const paragraph = tagsInside(tags, content.tag.end, contentClose.start).find(
      ({ tag }) => !tag.closing && tag.localName === "p"
    );
    if (paragraph === undefined) {
      throw new TemplateCompilerError(
        "sdt_paragraph_not_found",
        "В технической привязке DOCX отсутствует абзац."
      );
    }
    return {
      tags,
      sdtOpenIndex: sdtIndex,
      sdtCloseIndex,
      contentOpenIndex: content.index,
      contentCloseIndex,
      paragraphOpenIndex: paragraph.index,
      paragraphCloseIndex: matchingCloseIndex(tags, paragraph.index)
    };
  }
  throw new TemplateCompilerError(
    "technical_binding_not_found",
    "Техническая привязка DOCX не найдена. Повторите компиляцию черновика."
  );
}

function firstChildXml(
  xml: string,
  tags: readonly XmlTag[],
  parentOpenIndex: number,
  parentCloseIndex: number,
  wantedLocalName: string
): string {
  const parent = tags[parentOpenIndex];
  const parentClose = tags[parentCloseIndex];
  if (parent === undefined || parentClose === undefined) throwInvalidXml();
  const candidate = tagsInside(tags, parent.end, parentClose.start).find(
    ({ tag }) => !tag.closing && tag.localName === wantedLocalName
  );
  if (candidate === undefined) return "";
  const closeIndex = matchingCloseIndex(tags, candidate.index);
  const close = tags[closeIndex];
  if (close === undefined) throwInvalidXml();
  return xml.slice(candidate.tag.start, close.end);
}

function tagPrefix(qualifiedName: string): string {
  const separator = qualifiedName.indexOf(":");
  return separator < 0 ? "" : qualifiedName.slice(0, separator + 1);
}

function renderDocx(
  entries: readonly OoxmlPackageEntry[],
  technical: CompiledTechnicalBinding,
  value: NormalizedScalarValue
): OoxmlPackageEntry[] {
  const entry = packageEntry(entries, technical.part);
  const decoded = decodeXml(entry.content);
  const target = docxContentTarget(decoded.text, technical.identifier);
  const paragraph = target.tags[target.paragraphOpenIndex];
  const paragraphClose = target.tags[target.paragraphCloseIndex];
  if (paragraph === undefined || paragraphClose === undefined) throwInvalidXml();
  const paragraphProperties = firstChildXml(
    decoded.text,
    target.tags,
    target.paragraphOpenIndex,
    target.paragraphCloseIndex,
    "pPr"
  );
  const runProperties = firstChildXml(
    decoded.text,
    target.tags,
    target.paragraphOpenIndex,
    target.paragraphCloseIndex,
    "rPr"
  );
  const prefix = tagPrefix(paragraph.name) || "w:";
  const run = `<${prefix}r>${runProperties}<${prefix}t xml:space="preserve">${xmlText(value.display)}</${prefix}t></${prefix}r>`;
  const opening = decoded.text.slice(paragraph.start, paragraph.end);
  const closing = paragraph.selfClosing
    ? `</${paragraph.name}>`
    : decoded.text.slice(paragraphClose.start, paragraphClose.end);
  const replacement = `${opening.replace(/\/>$/u, ">")}${paragraphProperties}${run}${closing}`;
  const updated =
    decoded.text.slice(0, paragraph.start) +
    replacement +
    decoded.text.slice(paragraphClose.end);
  return replacePackageEntry(
    entries,
    technical.part,
    encodeXml(decoded, updated)
  );
}

function removeAttribute(openingTag: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return openingTag.replace(
    new RegExp(`\\s+${escapedName}\\s*=\\s*(["']).*?\\1`, "gu"),
    ""
  );
}

function setCellType(openingTag: string, type: string | null): string {
  const selfClosing = /\/>$/u.test(openingTag);
  let value = removeAttribute(openingTag, "t");
  value = value.replace(selfClosing ? /\/>$/u : />$/u, "");
  return `${value}${type === null ? "" : ` t="${xmlAttribute(type)}"`}>`;
}

function xlsxCellTarget(
  xml: string,
  address: string
): { tags: XmlTag[]; openIndex: number; closeIndex: number } {
  const tags = scanXmlTags(xml);
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (
      tag !== undefined &&
      !tag.closing &&
      tag.localName === "c" &&
      (attributeValue(tag.raw, "r") ?? "").toUpperCase() === address.toUpperCase()
    ) {
      return { tags, openIndex: index, closeIndex: matchingCloseIndex(tags, index) };
    }
  }
  throw new TemplateCompilerError(
    "cell_not_found",
    `Ячейка «${address}» не найдена в скомпилированной книге.`
  );
}

function renderXlsx(
  entries: readonly OoxmlPackageEntry[],
  binding: ScalarFieldBinding,
  value: NormalizedScalarValue
): OoxmlPackageEntry[] {
  if (binding.kind !== "xlsx.cell") {
    throw new TemplateCompilerError(
      "technical_binding_mismatch",
      "Для книги XLSX требуется координата ячейки."
    );
  }
  const entry = packageEntry(entries, binding.sheetPath);
  const decoded = decodeXml(entry.content);
  const target = xlsxCellTarget(decoded.text, binding.address);
  const cell = target.tags[target.openIndex];
  const cellClose = target.tags[target.closeIndex];
  if (cell === undefined || cellClose === undefined) throwInvalidXml();
  const formulaFound = tagsInside(
    target.tags,
    cell.end,
    cellClose.start
  ).some(({ tag }) => !tag.closing && tag.localName === "f");
  if (formulaFound) {
    throw new TemplateCompilerError(
      "formula_cell_not_supported",
      "Пробное значение нельзя записать поверх формулы. Выберите обычную ячейку."
    );
  }
  const originalOpening = decoded.text.slice(cell.start, cell.end);
  const opening = setCellType(
    originalOpening,
    value.xlsxMode === "inline-string"
      ? "inlineStr"
      : value.xlsxMode === "boolean"
        ? "b"
        : null
  );
  const prefix = tagPrefix(cell.name);
  const content =
    value.xlsxMode === "inline-string"
      ? `<${prefix}is><${prefix}t xml:space="preserve">${xmlText(value.xlsxValue)}</${prefix}t></${prefix}is>`
      : `<${prefix}v>${xmlText(value.xlsxValue)}</${prefix}v>`;
  const closing = cell.selfClosing
    ? `</${cell.name}>`
    : decoded.text.slice(cellClose.start, cellClose.end);
  const replacement = `${opening}${content}${closing}`;
  const updated =
    decoded.text.slice(0, cell.start) +
    replacement +
    decoded.text.slice(cellClose.end);
  return replacePackageEntry(
    entries,
    binding.sheetPath,
    encodeXml(decoded, updated)
  );
}

function readDocx(
  entries: readonly OoxmlPackageEntry[],
  technical: CompiledTechnicalBinding
): ReadScalarValueResult {
  const entry = packageEntry(entries, technical.part);
  const decoded = decodeXml(entry.content);
  const target = docxContentTarget(decoded.text, technical.identifier);
  const content = target.tags[target.contentOpenIndex];
  const contentClose = target.tags[target.contentCloseIndex];
  if (content === undefined || contentClose === undefined) throwInvalidXml();
  return {
    value: collectTextElements(decoded.text, content.end, contentClose.start),
    part: technical.part,
    target: technical.target
  };
}

function firstElementText(
  xml: string,
  tags: readonly XmlTag[],
  start: number,
  end: number,
  wantedLocalName: string
): string {
  const element = tagsInside(tags, start, end).find(
    ({ tag }) => !tag.closing && tag.localName === wantedLocalName
  );
  if (element === undefined) return "";
  const closeIndex = matchingCloseIndex(tags, element.index);
  const close = tags[closeIndex];
  if (close === undefined) throwInvalidXml();
  return decodeXmlText(xml.slice(element.tag.end, close.start));
}

function readXlsx(
  entries: readonly OoxmlPackageEntry[],
  binding: ScalarFieldBinding
): ReadScalarValueResult {
  if (binding.kind !== "xlsx.cell") {
    throw new TemplateCompilerError(
      "technical_binding_mismatch",
      "Для книги XLSX требуется координата ячейки."
    );
  }
  const entry = packageEntry(entries, binding.sheetPath);
  const decoded = decodeXml(entry.content);
  const target = xlsxCellTarget(decoded.text, binding.address);
  const cell = target.tags[target.openIndex];
  const cellClose = target.tags[target.closeIndex];
  if (cell === undefined || cellClose === undefined) throwInvalidXml();
  const type = attributeValue(cell.raw, "t") ?? "n";
  let value: string;
  if (type === "inlineStr") {
    value = collectTextElements(decoded.text, cell.end, cellClose.start);
  } else {
    const raw = firstElementText(
      decoded.text,
      target.tags,
      cell.end,
      cellClose.start,
      "v"
    );
    value = type === "b" ? (raw === "1" ? "Да" : "Нет") : raw;
  }
  return { value, part: binding.sheetPath, target: binding.address };
}

export async function readScalarValue(
  input: ReadScalarValueInput
): Promise<ReadScalarValueResult> {
  validateBindings(input.technicalBinding, input.fieldBinding);
  const entries = await readOoxmlPackage(input.document);
  return input.technicalBinding.kind === "docx.sdt"
    ? readDocx(entries, input.technicalBinding)
    : readXlsx(entries, input.fieldBinding);
}

export async function renderScalarValue(
  input: RenderScalarValueInput
): Promise<RenderScalarValueResult> {
  validateBindings(input.technicalBinding, input.fieldBinding);
  const compiled = Buffer.from(input.compiled);
  const normalized = normalizeScalarValue(input.valueType, input.value);
  const entries = await readOoxmlPackage(compiled);
  const updatedEntries =
    input.technicalBinding.kind === "docx.sdt"
      ? renderDocx(entries, input.technicalBinding, normalized)
      : renderXlsx(entries, input.fieldBinding, normalized);
  const output = writeOoxmlPackage(updatedEntries);
  const readBack = await readScalarValue({
    document: output,
    technicalBinding: input.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: input.valueType
  });
  if (readBack.value !== normalized.display) {
    throw new TemplateCompilerError(
      "trial_value_mismatch",
      "После пробного заполнения считанное значение не совпало с ожидаемым."
    );
  }
  return {
    output,
    inputSha256: sha256(compiled),
    outputSha256: sha256(output),
    renderedValue: normalized.display,
    readBackValue: readBack.value,
    modifiedPart: readBack.part,
    verification: {
      matched: true,
      message: "Пробное значение записано и повторно считано без расхождений."
    }
  };
}
