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

export interface XlsxCellBinding {
  version: 1;
  kind: "xlsx.cell";
  elementId: string;
  sheetName: string;
  sheetPath: string;
  address: string;
}

export type ScalarFieldBinding = DocxParagraphBinding | XlsxCellBinding;

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
    "Базовый компилятор поддерживает только целый абзац DOCX или одну ячейку XLSX."
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

function compileDocx(
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
  binding: CompiledTechnicalBinding
): Promise<void> {
  const entries = await readOoxmlPackage(output);
  const target = packageEntry(entries, binding.part);
  const text = decodeXml(target.content).text;
  if (binding.kind === "docx.sdt") {
    const found = scanXmlTags(text).some(
      (tag) =>
        !tag.closing &&
        tag.localName === "tag" &&
        (attributeValue(tag.raw, "w:val") ??
          attributeValue(tag.raw, "val")) === binding.identifier
    );
    if (!found) {
      throw new TemplateCompilerError(
        "compiled_binding_not_found",
        "После сборки не удалось повторно найти техническую привязку DOCX."
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
    binding.kind === "docx.paragraph" &&
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
      ? compileDocx(entries, binding, field)
      : compileXlsx(entries, binding, field);
  const output = writeOoxmlPackage(compiled.entries);
  await verifyTechnicalBinding(output, compiled.technicalBinding);

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
