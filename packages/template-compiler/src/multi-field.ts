import { createHash } from "node:crypto";

import {
  analyzeOoxmlBuffer,
  type DocumentStructureElement
} from "@docomator/document-intake";

import {
  compileScalarField,
  TemplateCompilerError,
  type CompileScalarFieldDefinition,
  type CompiledTechnicalBinding,
  type DocxParagraphBinding,
  type DocxTextRangeBinding,
  type ScalarFieldBinding,
  type XlsxCellBinding
} from "./compiler.js";
import {
  readScalarValue,
  renderScalarValue,
  type ScalarValueType
} from "./scalar-render.js";

export interface CompileScalarFieldsInput {
  source: Uint8Array;
  fileName: string;
  expectedSourceSha256: string;
  expectedStructureSha256: string;
  fields: readonly CompileScalarFieldDefinition[];
}

export interface CompiledScalarFieldResult {
  fieldId: string;
  fieldKey: string;
  originalElementId: string;
  modifiedPart: string;
  technicalBinding: CompiledTechnicalBinding;
}

export interface CompileScalarFieldsResult {
  output: Buffer;
  format: "docx" | "xlsx";
  sourceSha256: string;
  structureSha256: string;
  outputSha256: string;
  modifiedParts: string[];
  fields: CompiledScalarFieldResult[];
  verification: {
    found: true;
    checkedFields: number;
    message: string;
  };
}

export interface RenderScalarFieldValue {
  fieldId: string;
  fieldKey: string;
  technicalBinding: CompiledTechnicalBinding;
  fieldBinding: ScalarFieldBinding;
  valueType: ScalarValueType;
  value: unknown;
}

export interface RenderedScalarFieldValue {
  fieldId: string;
  fieldKey: string;
  renderedValue: string;
  readBackValue: string;
  modifiedPart: string;
  technicalBinding: CompiledTechnicalBinding;
}

export interface RenderScalarValuesInput {
  compiled: Uint8Array;
  fields: readonly RenderScalarFieldValue[];
}

export interface RenderScalarValuesResult {
  output: Buffer;
  inputSha256: string;
  outputSha256: string;
  modifiedParts: string[];
  fields: RenderedScalarFieldValue[];
  verification: {
    matched: true;
    checkedFields: number;
    message: string;
  };
}

interface NormalizedCompileField {
  id: string;
  key: string;
  label: string;
  elementId: string;
  binding: ScalarFieldBinding;
}

const MAX_FIELDS = 100;

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredText(value: unknown, label: string, maximum: number): string {
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
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    /\u0000/u.test(value)
  ) {
    throw new TemplateCompilerError(
      "invalid_binding",
      `Значение «${label}» имеет недопустимый размер или содержит запрещённый знак.`
    );
  }
  return value;
}

function expectedSha256(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new TemplateCompilerError(
      "invalid_expected_sha256",
      `${label} имеет недопустимый формат.`
    );
  }
  return normalized;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, label: string): number {
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
  const elementId = requiredText(
    value.elementId,
    "идентификатор элемента",
    160
  );
  if (value.kind === "docx.paragraph") {
    return {
      version: 1,
      kind: "docx.paragraph",
      elementId,
      part: requiredText(value.part, "часть DOCX", 500),
      index: integer(value.index, "номер абзаца"),
      ...(value.tableLocation === undefined
        ? {}
        : { tableLocation: value.tableLocation })
    };
  }
  if (value.kind === "docx.text-range") {
    const startOffset = integer(value.startOffset, "начало текста");
    const endOffset = integer(value.endOffset, "конец текста");
    if (endOffset <= startOffset || endOffset > 20_000) {
      throw new TemplateCompilerError(
        "invalid_binding",
        "Сохранённые границы текста DOCX имеют недопустимое значение."
      );
    }
    return {
      version: 1,
      kind: "docx.text-range",
      elementId,
      part: requiredText(value.part, "часть DOCX", 500),
      index: integer(value.index, "номер абзаца"),
      startOffset,
      endOffset,
      selectedText: exactText(value.selectedText, "выбранный текст"),
      ...(value.tableLocation === undefined
        ? {}
        : { tableLocation: value.tableLocation })
    };
  }
  if (value.kind === "xlsx.cell") {
    const address = requiredText(value.address, "адрес ячейки", 32).toUpperCase();
    if (!/^[A-Z]{1,4}[1-9][0-9]{0,6}$/u.test(address)) {
      throw new TemplateCompilerError(
        "invalid_binding",
        "Сохранённый адрес ячейки XLSX имеет недопустимый формат."
      );
    }
    return {
      version: 1,
      kind: "xlsx.cell",
      elementId,
      sheetName: requiredText(value.sheetName, "название листа", 255),
      sheetPath: requiredText(value.sheetPath, "часть листа", 500),
      address
    };
  }
  throw new TemplateCompilerError(
    "unsupported_binding",
    "Многополевой компилятор поддерживает целые абзацы или выбранный текст DOCX и отдельные ячейки XLSX."
  );
}

function coordinate(binding: ScalarFieldBinding): string {
  if (binding.kind === "docx.paragraph") {
    return `docx:${binding.part}:${binding.index}`;
  }
  if (binding.kind === "docx.text-range") {
    return `docx:${binding.part}:${binding.index}:${binding.startOffset}:${binding.endOffset}`;
  }
  return `xlsx:${binding.sheetPath}:${binding.address}`;
}

function ensureFieldCount(count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_FIELDS) {
    throw new TemplateCompilerError(
      "invalid_field_count",
      `За один проход можно обработать от 1 до ${MAX_FIELDS} полей.`
    );
  }
}

function unique(values: readonly string[], code: string, message: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new TemplateCompilerError(code, message);
    }
    seen.add(value);
  }
}

function normalizeCompileFields(
  fields: readonly CompileScalarFieldDefinition[]
): NormalizedCompileField[] {
  ensureFieldCount(fields.length);
  const normalized = fields.map((field) => {
    const elementId = requiredText(
      field.elementId,
      "идентификатор элемента",
      160
    );
    const binding = parseBinding(field.binding);
    if (binding.elementId !== elementId) {
      throw new TemplateCompilerError(
        "binding_element_mismatch",
        "Идентификатор поля не совпадает с сохранённой привязкой."
      );
    }
    return {
      id: requiredText(field.id, "идентификатор поля", 160),
      key: requiredText(field.key, "ключ поля", 160),
      label: requiredText(field.label, "название поля", 500),
      elementId,
      binding
    };
  });
  unique(
    normalized.map((field) => field.id),
    "duplicate_field_id",
    "Набор содержит повторяющийся идентификатор поля."
  );
  unique(
    normalized.map((field) => field.key),
    "duplicate_field_key",
    "Набор содержит повторяющийся ключ поля."
  );
  unique(
    normalized.map((field) => coordinate(field.binding)),
    "duplicate_field_coordinate",
    "Два поля не могут использовать одну структурную координату."
  );
  return normalized.sort(
    (left, right) =>
      left.key.localeCompare(right.key, "en") || left.id.localeCompare(right.id, "en")
  );
}

function locateElement(
  elements: readonly DocumentStructureElement[],
  binding: ScalarFieldBinding,
  format: "docx" | "xlsx"
): DocumentStructureElement {
  const element = elements.find((candidate) => {
    if (binding.kind === "docx.paragraph" || binding.kind === "docx.text-range") {
      return (
        format === "docx" &&
        candidate.kind === "paragraph" &&
        candidate.part === binding.part &&
        candidate.index === binding.index
      );
    }
    return (
      format === "xlsx" &&
      candidate.kind === "cell" &&
      candidate.sheetName === binding.sheetName &&
      candidate.sheetPath === binding.sheetPath &&
      candidate.address === binding.address
    );
  });
  if (element === undefined) {
    throw new TemplateCompilerError(
      "binding_coordinate_mismatch",
      binding.kind === "docx.paragraph" || binding.kind === "docx.text-range"
        ? "Координата абзаца не совпадает с текущей структурой DOCX."
        : "Координата ячейки не совпадает с текущей структурой XLSX."
    );
  }
  return element;
}

function remapBinding(
  binding: ScalarFieldBinding,
  elementId: string
): ScalarFieldBinding {
  if (binding.kind === "docx.paragraph") {
    return { ...binding, elementId } satisfies DocxParagraphBinding;
  }
  if (binding.kind === "docx.text-range") {
    return { ...binding, elementId } satisfies DocxTextRangeBinding;
  }
  return { ...binding, elementId } satisfies XlsxCellBinding;
}

export async function compileScalarFields(
  input: CompileScalarFieldsInput
): Promise<CompileScalarFieldsResult> {
  const source = Buffer.from(input.source);
  const normalizedFields = normalizeCompileFields(input.fields);
  const sourceHash = sha256(source);
  const wantedSourceHash = expectedSha256(
    input.expectedSourceSha256,
    "Контрольная сумма исходника"
  );
  if (sourceHash !== wantedSourceHash) {
    throw new TemplateCompilerError(
      "source_checksum_mismatch",
      "Исходный файл изменился после разметки. Повторите проверку и создание черновика."
    );
  }
  const initialAnalysis = await analyzeOoxmlBuffer({
    buffer: source,
    fileName: input.fileName,
    maxElements: 2_000
  });
  const wantedStructureHash = expectedSha256(
    input.expectedStructureSha256,
    "Контрольная сумма структуры"
  );
  if (initialAnalysis.structureSha256 !== wantedStructureHash) {
    throw new TemplateCompilerError(
      "structure_checksum_mismatch",
      "Структура исходника изменилась после сохранения полей. Повторите разметку."
    );
  }
  for (const field of normalizedFields) {
    const original = locateElement(
      initialAnalysis.elements,
      field.binding,
      initialAnalysis.format
    );
    if (original.id !== field.elementId) {
      throw new TemplateCompilerError(
        "binding_element_mismatch",
        `Поле «${field.label}» относится к другой версии структурного элемента.`
      );
    }
  }

  let current: Buffer<ArrayBufferLike> = source;
  const results: CompiledScalarFieldResult[] = [];
  for (const field of normalizedFields) {
    const analysis = await analyzeOoxmlBuffer({
      buffer: current,
      fileName: input.fileName,
      maxElements: 2_000
    });
    const currentElement = locateElement(
      analysis.elements,
      field.binding,
      analysis.format
    );
    const binding = remapBinding(field.binding, currentElement.id);
    const compiled = await compileScalarField({
      source: current,
      fileName: input.fileName,
      expectedSourceSha256: analysis.sourceSha256,
      expectedStructureSha256: analysis.structureSha256,
      field: {
        id: field.id,
        key: field.key,
        label: field.label,
        elementId: currentElement.id,
        binding
      }
    });
    current = compiled.output;
    results.push({
      fieldId: field.id,
      fieldKey: field.key,
      originalElementId: field.elementId,
      modifiedPart: compiled.modifiedPart,
      technicalBinding: compiled.technicalBinding
    });
  }

  return {
    output: current,
    format: initialAnalysis.format,
    sourceSha256: sourceHash,
    structureSha256: initialAnalysis.structureSha256,
    outputSha256: sha256(current),
    modifiedParts: [...new Set(results.map((field) => field.modifiedPart))].sort(),
    fields: results,
    verification: {
      found: true,
      checkedFields: results.length,
      message: `После сборки повторно найдены технические привязки: ${results.length}.`
    }
  };
}

function normalizeRenderFields(
  fields: readonly RenderScalarFieldValue[]
): RenderScalarFieldValue[] {
  ensureFieldCount(fields.length);
  const normalized = fields.map((field) => ({
    ...field,
    fieldId: requiredText(field.fieldId, "идентификатор поля", 160),
    fieldKey: requiredText(field.fieldKey, "ключ поля", 160)
  }));
  unique(
    normalized.map((field) => field.fieldId),
    "duplicate_field_id",
    "Набор значений содержит повторяющийся идентификатор поля."
  );
  unique(
    normalized.map((field) => field.fieldKey),
    "duplicate_field_key",
    "Набор значений содержит повторяющийся ключ поля."
  );
  unique(
    normalized.map((field) => field.technicalBinding.identifier),
    "duplicate_technical_binding",
    "Набор значений содержит повторяющуюся техническую привязку."
  );
  return normalized.sort(
    (left, right) =>
      left.fieldKey.localeCompare(right.fieldKey, "en") ||
      left.fieldId.localeCompare(right.fieldId, "en")
  );
}

export async function renderScalarValues(
  input: RenderScalarValuesInput
): Promise<RenderScalarValuesResult> {
  const original = Buffer.from(input.compiled);
  const fields = normalizeRenderFields(input.fields);
  let current: Buffer<ArrayBufferLike> = original;
  const rendered: RenderedScalarFieldValue[] = [];

  for (const field of fields) {
    const result = await renderScalarValue({
      compiled: current,
      technicalBinding: field.technicalBinding,
      fieldBinding: field.fieldBinding,
      valueType: field.valueType,
      value: field.value
    });
    current = result.output;
    rendered.push({
      fieldId: field.fieldId,
      fieldKey: field.fieldKey,
      renderedValue: result.renderedValue,
      readBackValue: result.readBackValue,
      modifiedPart: result.modifiedPart,
      technicalBinding: field.technicalBinding
    });
  }

  for (const field of fields) {
    const expected = rendered.find(
      (candidate) => candidate.fieldId === field.fieldId
    );
    if (expected === undefined) {
      throw new TemplateCompilerError(
        "rendered_field_missing",
        `Результат поля «${field.fieldKey}» не найден.`
      );
    }
    const readBack = await readScalarValue({
      document: current,
      technicalBinding: field.technicalBinding,
      fieldBinding: field.fieldBinding,
      valueType: field.valueType
    });
    expected.readBackValue = readBack.value;
    if (readBack.value !== expected.renderedValue) {
      throw new TemplateCompilerError(
        "trial_value_mismatch",
        `После итоговой сборки значение поля «${field.fieldKey}» не совпало с ожидаемым.`
      );
    }
  }

  return {
    output: current,
    inputSha256: sha256(original),
    outputSha256: sha256(current),
    modifiedParts: [...new Set(rendered.map((field) => field.modifiedPart))].sort(),
    fields: rendered,
    verification: {
      matched: true,
      checkedFields: rendered.length,
      message: `После итоговой сборки повторно считаны значения: ${rendered.length}.`
    }
  };
}
