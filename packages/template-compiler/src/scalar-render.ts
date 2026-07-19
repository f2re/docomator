import { createHash } from "node:crypto";

import {
  parseDocxRepeatRowContract,
  TemplateCompilerError,
  type CompiledRepeatTechnicalBinding,
  type CompiledTechnicalBinding,
  type DocxRepeatRowBinding,
  type ScalarFieldBinding
} from "./compiler.js";
import {
  formatScalarDisplay,
  parseScalarFormatter,
  type ScalarValueType
} from "./scalar-formatter.js";
import {
  packageEntry,
  readOoxmlPackage,
  writeOoxmlPackage,
  type OoxmlPackageEntry
} from "./ooxml-package.js";
import {
  hasCanonicalXlsxMetadata,
  verifyXlsxMetadata,
  verifyXlsxWorksheetBinding,
  xlsxMetadataRecord,
  type XlsxMetadataRecord
} from "./xlsx-metadata.js";

export type { ScalarValueType } from "./scalar-formatter.js";

export interface RenderScalarValueInput {
  compiled: Uint8Array;
  technicalBinding: CompiledTechnicalBinding;
  fieldBinding: ScalarFieldBinding;
  valueType: ScalarValueType;
  value: unknown;
  formatter?: unknown;
  expectedXlsxMetadataRecords?: readonly XlsxMetadataRecord[];
}

export interface ReadScalarValueInput {
  document: Uint8Array;
  technicalBinding: CompiledTechnicalBinding;
  fieldBinding: ScalarFieldBinding;
  valueType: ScalarValueType;
  formatter?: unknown;
  expectedXlsxMetadataRecords?: readonly XlsxMetadataRecord[];
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

export interface RenderDocxRepeatField {
  fieldId: string;
  fieldKey: string;
  required: boolean;
  technicalBinding: CompiledTechnicalBinding;
  fieldBinding: ScalarFieldBinding;
  valueType: ScalarValueType;
  formatter?: unknown;
}

export interface RenderDocxRepeatMember {
  memberId: string;
  values: readonly unknown[];
}

export interface RenderDocxRepeatRowsInput {
  compiled: Uint8Array;
  binding: DocxRepeatRowBinding;
  technicalBinding: CompiledRepeatTechnicalBinding;
  fields: readonly RenderDocxRepeatField[];
  members: readonly RenderDocxRepeatMember[];
}

export interface RenderDocxRepeatRowsResult {
  output: Buffer;
  inputSha256: string;
  outputSha256: string;
  modifiedPart: string;
  rowCount: number;
  fieldCount: number;
  verification: {
    matched: true;
    checkedValues: number;
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

export interface NormalizedScalarValue {
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
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(text)) {
    throw new TemplateCompilerError(
      "invalid_trial_value",
      "Пробные дата и время должны содержать явный часовой пояс."
    );
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new TemplateCompilerError(
      "invalid_trial_value",
      "Указаны недопустимые дата и время."
    );
  }
  return date.toISOString();
}

export function normalizeScalarValueForRendering(
  valueType: ScalarValueType,
  value: unknown,
  formatterValue: unknown
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
    return {
      display: formatScalarDisplay(valueType, number, formatterValue),
      xlsxMode: "number",
      xlsxValue: number
    };
  }
  if (valueType === "boolean") {
    if (typeof value !== "boolean") {
      throw new TemplateCompilerError(
        "invalid_trial_value",
        "Пробное логическое значение должно быть «да» или «нет»."
      );
    }
    return {
      display: formatScalarDisplay(valueType, value, formatterValue),
      xlsxMode: "boolean",
      xlsxValue: value ? "1" : "0"
    };
  }
  if (valueType === "date") {
    const text = normalizeDate(value);
    return {
      display: formatScalarDisplay(valueType, text, formatterValue),
      xlsxMode: "inline-string",
      xlsxValue: formatScalarDisplay(valueType, text, formatterValue)
    };
  }
  if (valueType === "date-time") {
    const text = normalizeDateTime(value);
    return {
      display: formatScalarDisplay(valueType, text, formatterValue),
      xlsxMode: "inline-string",
      xlsxValue: formatScalarDisplay(valueType, text, formatterValue)
    };
  }
  throw new TemplateCompilerError(
    "unsupported_trial_value_type",
    "Тип пробного значения пока не поддерживается."
  );
}

export function validateScalarBindings(
  technical: CompiledTechnicalBinding,
  field: ScalarFieldBinding
): void {
  if (technical.kind !== "docx.sdt" && technical.kind !== "xlsx.defined-name") {
    throw new TemplateCompilerError(
      "technical_binding_mismatch",
      "Вид технической привязки не поддерживается."
    );
  }
  if (technical.kind === "docx.sdt") {
    if (field.kind !== "docx.paragraph" && field.kind !== "docx.text-range") {
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
    if (
      technical.metadataVersion !== undefined ||
      !/^aifield:.{1,160}$/u.test(technical.identifier) ||
      /[\u0000-\u001f\u007f]/u.test(technical.identifier)
    ) {
      throw new TemplateCompilerError(
        "technical_binding_mismatch",
        "Техническая привязка DOCX имеет неподдерживаемый формат."
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
  const address = /^([A-Z]{1,4})([1-9][0-9]{0,6})$/u.exec(field.address);
  const expectedTarget =
    address === null
      ? null
      : `'${field.sheetName.replaceAll("'", "''")}'!$${address[1]}$${address[2]}`;
  if (
    technical.part !== "xl/workbook.xml" ||
    !/^_DOCOMATOR_[A-F0-9]{24}$/u.test(technical.identifier) ||
    expectedTarget === null ||
    technical.target !== expectedTarget ||
    (technical.metadataVersion !== undefined && technical.metadataVersion !== 1)
  ) {
    throw new TemplateCompilerError(
      "technical_binding_mismatch",
      "Техническая привязка XLSX не соответствует сохранённой ячейке или версии служебных данных."
    );
  }
}

function verifyRequiredXlsxMetadata(
  entries: readonly OoxmlPackageEntry[],
  technical: CompiledTechnicalBinding,
  expectedRecords?: readonly XlsxMetadataRecord[]
): void {
  if (technical.kind !== "xlsx.defined-name") {
    return;
  }
  if (technical.metadataVersion !== 1) {
    if (hasCanonicalXlsxMetadata(entries)) {
      throw new TemplateCompilerError(
        "xlsx_metadata_version_downgrade",
        "Книга содержит новые служебные данные XLSX, но привязка помечена как прежняя. Повторно активируйте шаблон."
      );
    }
    return;
  }
  verifyXlsxMetadata(entries, {
    expectedRecords:
      expectedRecords ?? [xlsxMetadataRecord("field", technical)],
    exactExpectedRecords: true,
    definedNames: "present"
  });
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

function directChildElements(
  tags: readonly XmlTag[],
  parentOpenIndex: number,
  parentCloseIndex: number
): Array<{ tag: XmlTag; index: number; closeIndex: number }> {
  const result: Array<{ tag: XmlTag; index: number; closeIndex: number }> = [];
  let index = parentOpenIndex + 1;
  while (index < parentCloseIndex) {
    const tag = tags[index];
    if (tag === undefined || tag.closing) throwInvalidXml();
    const closeIndex = matchingCloseIndex(tags, index);
    if (closeIndex > parentCloseIndex) throwInvalidXml();
    result.push({ tag, index, closeIndex });
    index = closeIndex + 1;
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
    const children = directChildElements(tags, sdtIndex, sdtCloseIndex);
    const properties = children.find(
      ({ tag }) => tag.localName === "sdtPr"
    );
    const propertiesClose =
      properties === undefined ? undefined : tags[properties.closeIndex];
    const identifierFound =
      properties !== undefined &&
      propertiesClose !== undefined &&
      directChildElements(tags, properties.index, properties.closeIndex).some(
        ({ tag }) =>
          tag.localName === "tag" &&
          (attributeValue(tag.raw, "w:val") ??
            attributeValue(tag.raw, "val")) === identifier
      );
    if (!identifierFound) continue;
    const content = children.find(
      ({ tag }) => tag.localName === "sdtContent"
    );
    if (content === undefined) {
      throw new TemplateCompilerError(
        "sdt_content_not_found",
        "В технической привязке DOCX отсутствует содержимое."
      );
    }
    const contentCloseIndex = content.closeIndex;
    const contentClose = tags[contentCloseIndex];
    if (contentClose === undefined) throwInvalidXml();
    return {
      tags,
      sdtOpenIndex: sdtIndex,
      sdtCloseIndex,
      contentOpenIndex: content.index,
      contentCloseIndex
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

interface XmlReplacement {
  start: number;
  end: number;
  value: string;
}

function applyXmlReplacements(
  xml: string,
  replacements: readonly XmlReplacement[]
): string {
  const ordered = [...replacements].sort((left, right) => left.start - right.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const replacement of ordered) {
    if (
      replacement.start < cursor ||
      replacement.start < 0 ||
      replacement.end < replacement.start ||
      replacement.end > xml.length
    ) {
      throwInvalidXml();
    }
    parts.push(xml.slice(cursor, replacement.start), replacement.value);
    cursor = replacement.end;
  }
  parts.push(xml.slice(cursor));
  return parts.join("");
}

function docxValueReplacement(
  xml: string,
  target: ReturnType<typeof docxContentTarget>,
  binding: ScalarFieldBinding,
  value: NormalizedScalarValue
): XmlReplacement {
  const content = target.tags[target.contentOpenIndex];
  const contentClose = target.tags[target.contentCloseIndex];
  if (content === undefined || contentClose === undefined) throwInvalidXml();
  if (binding.kind === "docx.paragraph") {
    const paragraph = tagsInside(
      target.tags,
      content.end,
      contentClose.start
    ).find(({ tag }) => !tag.closing && tag.localName === "p");
    if (paragraph === undefined) {
      throw new TemplateCompilerError(
        "sdt_paragraph_not_found",
        "В технической привязке DOCX отсутствует абзац."
      );
    }
    const paragraphCloseIndex = matchingCloseIndex(
      target.tags,
      paragraph.index
    );
    const paragraphClose = target.tags[paragraphCloseIndex];
    if (paragraphClose === undefined) throwInvalidXml();
    const paragraphProperties = firstChildXml(
      xml,
      target.tags,
      paragraph.index,
      paragraphCloseIndex,
      "pPr"
    );
    const runProperties = firstChildXml(
      xml,
      target.tags,
      paragraph.index,
      paragraphCloseIndex,
      "rPr"
    );
    const prefix = tagPrefix(paragraph.tag.name) || "w:";
    const run = `<${prefix}r>${runProperties}<${prefix}t xml:space="preserve">${xmlText(value.display)}</${prefix}t></${prefix}r>`;
    const opening = xml.slice(paragraph.tag.start, paragraph.tag.end);
    const closing = paragraph.tag.selfClosing
      ? `</${paragraph.tag.name}>`
      : xml.slice(paragraphClose.start, paragraphClose.end);
    const replacement = `${opening.replace(/\/>$/u, ">")}${paragraphProperties}${run}${closing}`;
    return {
      start: paragraph.tag.start,
      end: paragraphClose.end,
      value: replacement
    };
  }
  if (binding.kind === "docx.text-range") {
    const run = tagsInside(target.tags, content.end, contentClose.start).find(
      ({ tag }) => !tag.closing && tag.localName === "r"
    );
    if (run === undefined) {
      throw new TemplateCompilerError(
        "sdt_run_not_found",
        "В технической привязке выбранного текста DOCX отсутствует текстовый фрагмент."
      );
    }
    const runCloseIndex = matchingCloseIndex(target.tags, run.index);
    const runProperties = firstChildXml(
      xml,
      target.tags,
      run.index,
      runCloseIndex,
      "rPr"
    );
    const prefix = tagPrefix(run.tag.name) || "w:";
    const replacement = `<${prefix}r>${runProperties}<${prefix}t xml:space="preserve">${xmlText(value.display)}</${prefix}t></${prefix}r>`;
    return {
      start: content.end,
      end: contentClose.start,
      value: replacement
    };
  }
  throw new TemplateCompilerError(
    "technical_binding_mismatch",
    "Для DOCX требуется координата абзаца или выбранного текста."
  );
}

function renderDocxXml(
  xml: string,
  technical: CompiledTechnicalBinding,
  binding: ScalarFieldBinding,
  value: NormalizedScalarValue
): string {
  const target = docxContentTarget(xml, technical.identifier);
  return applyXmlReplacements(xml, [
    docxValueReplacement(xml, target, binding, value)
  ]);
}

function renderDocx(
  entries: readonly OoxmlPackageEntry[],
  technical: CompiledTechnicalBinding,
  binding: ScalarFieldBinding,
  value: NormalizedScalarValue
): OoxmlPackageEntry[] {
  const entry = packageEntry(entries, technical.part);
  const decoded = decodeXml(entry.content);
  return replacePackageEntry(
    entries,
    technical.part,
    encodeXml(decoded, renderDocxXml(decoded.text, technical, binding, value))
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

function repeatValueMissing(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

function directDocxRows(
  xml: string,
  tags: readonly XmlTag[],
  contentOpenIndex: number,
  contentCloseIndex: number
): string[] {
  const children = directChildElements(
    tags,
    contentOpenIndex,
    contentCloseIndex
  );
  if (children.some(({ tag }) => tag.localName !== "tr")) {
    throw new TemplateCompilerError(
      "repeat_row_structure_mismatch",
      "Техническая привязка повтора должна содержать только строки таблицы DOCX."
    );
  }
  return children.map(({ tag, closeIndex }) => {
    const close = tags[closeIndex];
    if (close === undefined) throwInvalidXml();
    return xml.slice(tag.start, close.end);
  });
}

function setWordIdAttribute(opening: string, value: number): string {
  const expression = /(\s+(?:[A-Za-z_][\w.-]*:)?val\s*=\s*)(["']).*?\2/u;
  if (!expression.test(opening)) {
    throw new TemplateCompilerError(
      "repeat_field_id_missing",
      "В технической привязке поля отсутствует идентификатор Word."
    );
  }
  return opening.replace(expression, `$1"${value}"`);
}

function repeatWordId(fieldId: string, memberIndex: number): number {
  const raw = createHash("sha256")
    .update("repeat-member")
    .update("\u0000")
    .update(fieldId)
    .update("\u0000")
    .update(String(memberIndex))
    .digest()
    .readUInt32BE(0);
  const positive = raw & 0x7fffffff;
  return positive === 0 ? 1 : positive;
}

function existingWordIds(xml: string): Set<number> {
  const values = new Set<number>();
  for (const tag of scanXmlTags(xml)) {
    if (tag.closing || tag.localName !== "id") continue;
    const raw = attributeValue(tag.raw, "w:val") ?? attributeValue(tag.raw, "val");
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0 && value <= 0x7fffffff) {
      values.add(value);
    }
  }
  return values;
}

function allocateRepeatWordId(
  fieldId: string,
  memberIndex: number,
  used: Set<number>
): number {
  let candidate = repeatWordId(fieldId, memberIndex);
  const first = candidate;
  do {
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    candidate = candidate === 0x7fffffff ? 1 : candidate + 1;
  } while (candidate !== first);
  throw new TemplateCompilerError(
    "repeat_field_id_exhausted",
    "Не удалось назначить уникальные идентификаторы повторяемым полям DOCX."
  );
}

function docxWordIdReplacement(
  xml: string,
  target: ReturnType<typeof docxContentTarget>,
  value: number
): XmlReplacement {
  const children = directChildElements(
    target.tags,
    target.sdtOpenIndex,
    target.sdtCloseIndex
  );
  const properties = children.find(
    ({ tag }) => tag.localName === "sdtPr"
  );
  if (properties === undefined) throwInvalidXml();
  const id = directChildElements(
    target.tags,
    properties.index,
    properties.closeIndex
  ).find(({ tag }) => tag.localName === "id");
  if (id === undefined) {
    throw new TemplateCompilerError(
      "repeat_field_id_missing",
      "В технической привязке поля отсутствует идентификатор Word."
    );
  }
  const opening = xml.slice(id.tag.start, id.tag.end);
  return {
    start: id.tag.start,
    end: id.tag.end,
    value: setWordIdAttribute(opening, value)
  };
}

function readDocxSdtValues(
  xml: string,
  wanted: ReadonlySet<string>
): Map<string, { count: number; value: string }> {
  const tags = scanXmlTags(xml);
  const result = new Map<string, { count: number; value: string }>();
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
    const children = directChildElements(tags, index, sdtCloseIndex);
    const properties = children.find(({ tag }) => tag.localName === "sdtPr");
    if (properties === undefined) continue;
    const identifierTag = directChildElements(
      tags,
      properties.index,
      properties.closeIndex
    ).find(({ tag }) => tag.localName === "tag");
    const identifier =
      identifierTag === undefined
        ? null
        : (attributeValue(identifierTag.tag.raw, "w:val") ??
          attributeValue(identifierTag.tag.raw, "val"));
    if (identifier === null || !wanted.has(identifier)) continue;
    const content = children.find(
      ({ tag }) => tag.localName === "sdtContent"
    );
    const contentClose =
      content === undefined ? undefined : tags[content.closeIndex];
    if (content === undefined || contentClose === undefined) throwInvalidXml();
    const previous = result.get(identifier);
    result.set(identifier, {
      count: (previous?.count ?? 0) + 1,
      value: collectTextElements(xml, content.tag.end, contentClose.start)
    });
  }
  return result;
}

function wordIdCounts(xml: string): Map<number, number> {
  const counts = new Map<number, number>();
  for (const tag of scanXmlTags(xml)) {
    if (tag.closing || tag.localName !== "id") continue;
    const raw = attributeValue(tag.raw, "w:val") ?? attributeValue(tag.raw, "val");
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0 && value <= 0x7fffffff) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

export async function renderDocxRepeatRows(
  input: RenderDocxRepeatRowsInput
): Promise<RenderDocxRepeatRowsResult> {
  parseDocxRepeatRowContract({
    version: 1,
    kind: "docx.repeat-row-contract",
    binding: input.binding,
    technicalBinding: input.technicalBinding
  });
  if (
    input.binding.kind !== "docx.repeat-row" ||
    input.binding.source !== "audience.members" ||
    input.technicalBinding.kind !== "docx.repeat-sdt" ||
    input.binding.part !== input.technicalBinding.part
  ) {
    throw new TemplateCompilerError(
      "repeat_binding_mismatch",
      "Техническая привязка повтора не соответствует сохранённой строке DOCX."
    );
  }
  if (input.fields.length < 1 || input.fields.length > 100) {
    throw new TemplateCompilerError(
      "invalid_repeat_field_count",
      "Повторяемая строка должна содержать от 1 до 100 полей."
    );
  }
  if (input.members.length < 1 || input.members.length > 1_000) {
    throw new TemplateCompilerError(
      "invalid_repeat_member_count",
      "Для повторяемой строки требуется от 1 до 1000 участников."
    );
  }
  const fieldIdentifiers = new Set<string>();
  for (const field of input.fields) {
    if (
      field.technicalBinding.kind !== "docx.sdt" ||
      field.technicalBinding.part !== input.binding.part ||
      (field.fieldBinding.kind !== "docx.paragraph" &&
        field.fieldBinding.kind !== "docx.text-range")
    ) {
      throw new TemplateCompilerError(
        "repeat_field_outside_row",
        "Повторяемая строка DOCX содержит несовместимое скалярное поле."
      );
    }
    if (fieldIdentifiers.has(field.technicalBinding.identifier)) {
      throw new TemplateCompilerError(
        "duplicate_repeat_field",
        "Повторяемая строка содержит повторяющуюся техническую привязку."
      );
    }
    fieldIdentifiers.add(field.technicalBinding.identifier);
  }
  for (const member of input.members) {
    if (member.values.length !== input.fields.length) {
      throw new TemplateCompilerError(
        "repeat_member_value_count_mismatch",
        "Набор значений участника не совпадает с полями повторяемой строки."
      );
    }
  }

  const compiled = Buffer.from(input.compiled);
  const entries = await readOoxmlPackage(compiled);
  const entry = packageEntry(entries, input.binding.part);
  const decoded = decodeXml(entry.content);
  const target = docxContentTarget(
    decoded.text,
    input.technicalBinding.identifier
  );
  const content = target.tags[target.contentOpenIndex];
  const contentClose = target.tags[target.contentCloseIndex];
  if (content === undefined || contentClose === undefined) throwInvalidXml();
  const templates = directDocxRows(
    decoded.text,
    target.tags,
    target.contentOpenIndex,
    target.contentCloseIndex
  );
  if (templates.length !== 1) {
    throw new TemplateCompilerError(
      "repeat_template_row_count_mismatch",
      "Скомпилированный повтор должен содержать ровно одну строку-образец."
    );
  }
  const template = templates[0];
  if (template === undefined) throwInvalidXml();
  const templateValues = readDocxSdtValues(template, fieldIdentifiers);
  const fieldTargets = input.fields.map((field, fieldIndex) => {
    if (templateValues.get(field.technicalBinding.identifier)?.count !== 1) {
      throw new TemplateCompilerError(
        "repeat_field_count_mismatch",
        `В строке-образце поле «${field.fieldKey}» найдено не ровно один раз.`
      );
    }
    return {
      field,
      fieldIndex,
      target: docxContentTarget(template, field.technicalBinding.identifier)
    };
  });
  const expectedRows: string[][] = [];
  const usedWordIds = existingWordIds(decoded.text);
  const generatedWordIds = new Set<number>();
  let expandedRowsBytes = 0;
  const renderedRows = input.members.map((member, memberIndex) => {
    const replacements: XmlReplacement[] = [];
    const expected = Array<string>(input.fields.length);
    for (const { field, fieldIndex, target: fieldTarget } of fieldTargets) {
      const value = member.values[fieldIndex];
      const missing = repeatValueMissing(value);
      if (missing && field.required) {
        throw new TemplateCompilerError(
          "repeat_required_value_missing",
          `Для участника ${memberIndex + 1} не заполнено обязательное поле «${field.fieldKey}».`
        );
      }
      const normalized: NormalizedScalarValue = missing
        ? { display: "", xlsxMode: "inline-string", xlsxValue: "" }
        : normalizeScalarValueForRendering(
            field.valueType,
            value,
            field.formatter
          );
      const wordId = allocateRepeatWordId(
        field.fieldId,
        memberIndex,
        usedWordIds
      );
      generatedWordIds.add(wordId);
      replacements.push(
        docxWordIdReplacement(template, fieldTarget, wordId),
        docxValueReplacement(
          template,
          fieldTarget,
          field.fieldBinding,
          normalized
        )
      );
      expected[fieldIndex] = normalized.display;
    }
    const row = applyXmlReplacements(template, replacements);
    expandedRowsBytes += Buffer.byteLength(row, "utf8");
    if (expandedRowsBytes > 32 * 1024 * 1024) {
      throw new TemplateCompilerError(
        "repeat_output_too_large",
        "Повторяемые строки превышают безопасный размер части DOCX. Уменьшите состав или объём значений."
      );
    }
    expectedRows.push(expected);
    return row;
  });
  const updatedXml =
    decoded.text.slice(0, content.end) +
    renderedRows.join("") +
    decoded.text.slice(contentClose.start);
  if (Buffer.byteLength(updatedXml, "utf8") > 32 * 1024 * 1024) {
    throw new TemplateCompilerError(
      "repeat_output_too_large",
      "Сформированная часть DOCX превышает безопасный размер. Уменьшите состав или объём значений."
    );
  }
  const output = writeOoxmlPackage(
    replacePackageEntry(
      entries,
      input.binding.part,
      encodeXml(decoded, updatedXml)
    )
  );

  const verifiedEntries = await readOoxmlPackage(output);
  const verifiedDecoded = decodeXml(
    packageEntry(verifiedEntries, input.binding.part).content
  );
  const verifiedWordIds = wordIdCounts(verifiedDecoded.text);
  if (
    generatedWordIds.size !== input.members.length * input.fields.length ||
    [...generatedWordIds].some((wordId) => verifiedWordIds.get(wordId) !== 1)
  ) {
    throw new TemplateCompilerError(
      "repeat_field_id_mismatch",
      "После формирования идентификаторы повторяемых полей DOCX не остались уникальными."
    );
  }
  const verifiedTarget = docxContentTarget(
    verifiedDecoded.text,
    input.technicalBinding.identifier
  );
  const verifiedRows = directDocxRows(
    verifiedDecoded.text,
    verifiedTarget.tags,
    verifiedTarget.contentOpenIndex,
    verifiedTarget.contentCloseIndex
  );
  if (verifiedRows.length !== input.members.length) {
    throw new TemplateCompilerError(
      "repeat_row_count_mismatch",
      "После формирования число строк не совпало с зафиксированным составом участников."
    );
  }
  for (const [rowIndex, row] of verifiedRows.entries()) {
    const values = readDocxSdtValues(row, fieldIdentifiers);
    for (const [fieldIndex, field] of input.fields.entries()) {
      const readBack = values.get(field.technicalBinding.identifier);
      if (readBack?.count !== 1) {
        throw new TemplateCompilerError(
          "repeat_field_count_mismatch",
          `В строке ${rowIndex + 1} поле «${field.fieldKey}» найдено не ровно один раз.`
        );
      }
      if (readBack.value !== expectedRows[rowIndex]?.[fieldIndex]) {
        throw new TemplateCompilerError(
          "repeat_value_mismatch",
          `После формирования значение поля «${field.fieldKey}» в строке ${rowIndex + 1} не совпало с ожидаемым.`
        );
      }
    }
  }
  return {
    output,
    inputSha256: sha256(compiled),
    outputSha256: sha256(output),
    modifiedPart: input.binding.part,
    rowCount: verifiedRows.length,
    fieldCount: input.fields.length,
    verification: {
      matched: true,
      checkedValues: verifiedRows.length * input.fields.length,
      message: `Повторно проверены строки (${verifiedRows.length}) и значения (${verifiedRows.length * input.fields.length}).`
    }
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
  binding: ScalarFieldBinding,
  valueType: ScalarValueType,
  formatterValue: unknown
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
    value =
      type === "b"
        ? formatScalarDisplay(valueType, raw === "1", formatterValue)
        : type === "n" && (valueType === "number" || valueType === "integer")
          ? formatScalarDisplay(valueType, raw, formatterValue)
          : raw;
  }
  return { value, part: binding.sheetPath, target: binding.address };
}

export async function readScalarValue(
  input: ReadScalarValueInput
): Promise<ReadScalarValueResult> {
  validateScalarBindings(input.technicalBinding, input.fieldBinding);
  parseScalarFormatter(input.valueType, input.formatter);
  const entries = await readOoxmlPackage(input.document);
  if (
    input.technicalBinding.kind === "xlsx.defined-name" &&
    input.fieldBinding.kind === "xlsx.cell"
  ) {
    verifyXlsxWorksheetBinding(
      entries,
      input.fieldBinding.sheetName,
      input.fieldBinding.sheetPath
    );
  }
  verifyRequiredXlsxMetadata(
    entries,
    input.technicalBinding,
    input.expectedXlsxMetadataRecords
  );
  return input.technicalBinding.kind === "docx.sdt"
    ? readDocx(entries, input.technicalBinding)
    : readXlsx(
        entries,
        input.fieldBinding,
        input.valueType,
        input.formatter
      );
}

export async function renderScalarValue(
  input: RenderScalarValueInput
): Promise<RenderScalarValueResult> {
  validateScalarBindings(input.technicalBinding, input.fieldBinding);
  const compiled = Buffer.from(input.compiled);
  const normalized = normalizeScalarValueForRendering(
    input.valueType,
    input.value,
    input.formatter
  );
  const entries = await readOoxmlPackage(compiled);
  if (
    input.technicalBinding.kind === "xlsx.defined-name" &&
    input.fieldBinding.kind === "xlsx.cell"
  ) {
    verifyXlsxWorksheetBinding(
      entries,
      input.fieldBinding.sheetName,
      input.fieldBinding.sheetPath
    );
  }
  verifyRequiredXlsxMetadata(
    entries,
    input.technicalBinding,
    input.expectedXlsxMetadataRecords
  );
  const updatedEntries =
    input.technicalBinding.kind === "docx.sdt"
      ? renderDocx(
          entries,
          input.technicalBinding,
          input.fieldBinding,
          normalized
        )
      : renderXlsx(entries, input.fieldBinding, normalized);
  const output = writeOoxmlPackage(updatedEntries);
  const readBack = await readScalarValue({
    document: output,
    technicalBinding: input.technicalBinding,
    fieldBinding: input.fieldBinding,
    valueType: input.valueType,
    formatter: input.formatter,
    ...(input.expectedXlsxMetadataRecords === undefined
      ? {}
      : {
          expectedXlsxMetadataRecords: input.expectedXlsxMetadataRecords
        })
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
