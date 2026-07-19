import { createHash } from "node:crypto";

import {
  analyzeOoxmlBuffer,
  type DocumentStructureElement
} from "@docomator/document-intake";

import {
  compileDocxRepeatRow,
  compileScalarField,
  parseDocxRepeatRowBinding,
  TemplateCompilerError,
  type CompileScalarFieldDefinition,
  type CompiledRepeatTechnicalBinding,
  type CompiledTechnicalBinding,
  type DocxParagraphBinding,
  type DocxRepeatRowBinding,
  type DocxTextRangeBinding,
  type ScalarFieldBinding,
  type XlsxCellBinding
} from "./compiler.js";
import {
  readScalarValue,
  renderScalarValue,
  type ScalarValueType
} from "./scalar-render.js";
import {
  compileXlsxRepeatRow,
  parseXlsxRepeatRowBinding,
  type XlsxRepeatRowBinding,
  type XlsxRepeatTechnicalBinding
} from "./xlsx-repeat.js";
import { readOoxmlPackage } from "./ooxml-package.js";
import {
  verifyXlsxMetadata,
  xlsxMetadataRecord
} from "./xlsx-metadata.js";

export interface CompileScalarFieldsInput {
  source: Uint8Array;
  fileName: string;
  expectedSourceSha256: string;
  expectedStructureSha256: string;
  fields: readonly CompileScalarFieldDefinition[];
  repeatBinding?: unknown;
}

export interface CompiledScalarFieldResult {
  fieldId: string;
  fieldKey: string;
  originalElementId: string;
  modifiedPart: string;
  modifiedParts: string[];
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
  repeat:
    | {
        binding: DocxRepeatRowBinding;
        technicalBinding: CompiledRepeatTechnicalBinding;
      }
    | {
        binding: XlsxRepeatRowBinding;
        technicalBinding: XlsxRepeatTechnicalBinding;
      }
    | null;
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
  formatter?: unknown;
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
  repeatTechnicalBinding?: XlsxRepeatTechnicalBinding;
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
const MAX_XLSX_COLUMN = 16_384;
const MAX_XLSX_ROW = 1_048_576;

type RepeatRowBinding = DocxRepeatRowBinding | XlsxRepeatRowBinding;

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

function parseRepeatRowBinding(value: unknown): RepeatRowBinding {
  return isObject(value) && value.kind === "xlsx.repeat-row"
    ? parseXlsxRepeatRowBinding(value)
    : parseDocxRepeatRowBinding(value);
}

function xlsxCoordinate(address: string): { column: number; row: number } {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(address.toUpperCase());
  if (match === null) {
    throw new TemplateCompilerError(
      "invalid_cell_address",
      "Сохранённый адрес ячейки XLSX имеет недопустимый формат."
    );
  }
  let column = 0;
  for (const character of match[1] ?? "") {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  const row = Number(match[2]);
  if (column < 1 || column > MAX_XLSX_COLUMN || row < 1 || row > MAX_XLSX_ROW) {
    throw new TemplateCompilerError(
      "invalid_cell_address",
      "Сохранённый адрес ячейки находится за пределами XLSX."
    );
  }
  return { column, row };
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
  const repeatBinding =
    input.repeatBinding === undefined
      ? null
      : parseRepeatRowBinding(input.repeatBinding);
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
    if (repeatBinding !== null) {
      if (repeatBinding.kind === "docx.repeat-row") {
        if (
          initialAnalysis.format !== "docx" ||
          original.kind !== "paragraph" ||
          original.part !== repeatBinding.part ||
          original.tableLocation?.tableIndex !== repeatBinding.tableIndex ||
          original.tableLocation.rowIndex !== repeatBinding.rowIndex
        ) {
          throw new TemplateCompilerError(
            "repeat_field_outside_row",
            `Поле «${field.label}» находится вне выбранной повторяемой строки.`
          );
        }
      } else {
        const fieldCoordinate =
          original.kind === "cell" ? xlsxCoordinate(original.address) : null;
        const start = xlsxCoordinate(repeatBinding.startAddress);
        const end = xlsxCoordinate(repeatBinding.endAddress);
        if (
          initialAnalysis.format !== "xlsx" ||
          original.kind !== "cell" ||
          original.sheetName !== repeatBinding.sheetName ||
          original.sheetPath !== repeatBinding.sheetPath ||
          fieldCoordinate?.row !== repeatBinding.rowNumber ||
          fieldCoordinate.column < start.column ||
          fieldCoordinate.column > end.column
        ) {
          throw new TemplateCompilerError(
            "repeat_field_outside_row",
            `Поле «${field.label}» находится вне выбранного повторяемого диапазона XLSX.`
          );
        }
      }
    }
  }
  if (repeatBinding !== null) {
    if (repeatBinding.kind === "docx.repeat-row") {
      const anchor = initialAnalysis.elements.find(
        (element) => element.id === repeatBinding.anchorElementId
      );
      if (
        initialAnalysis.format !== "docx" ||
        anchor?.kind !== "paragraph" ||
        anchor.part !== repeatBinding.part ||
        anchor.tableLocation?.tableIndex !== repeatBinding.tableIndex ||
        anchor.tableLocation.rowIndex !== repeatBinding.rowIndex
      ) {
        throw new TemplateCompilerError(
          "repeat_anchor_mismatch",
          "Опорный элемент повторяемой строки не совпадает с текущей структурой DOCX."
        );
      }
    } else {
      const start = initialAnalysis.elements.find(
        (element) => element.id === repeatBinding.startElementId
      );
      const end = initialAnalysis.elements.find(
        (element) => element.id === repeatBinding.endElementId
      );
      const exactEndpoint = (
        element: DocumentStructureElement | undefined,
        address: string
      ): boolean =>
        element?.kind === "cell" &&
        element.sheetName === repeatBinding.sheetName &&
        element.sheetPath === repeatBinding.sheetPath &&
        element.address === address;
      if (
        initialAnalysis.format !== "xlsx" ||
        !exactEndpoint(start, repeatBinding.startAddress) ||
        !exactEndpoint(end, repeatBinding.endAddress)
      ) {
        throw new TemplateCompilerError(
          "repeat_anchor_mismatch",
          "Границы повторяемого диапазона не совпадают с текущей структурой XLSX."
        );
      }
      if (repeatBinding.selection === "used-row") {
        if (initialAnalysis.truncated) {
          throw new TemplateCompilerError(
            "repeat_structure_truncated",
            "Структура XLSX усечена: нельзя надёжно определить всю используемую строку."
          );
        }
        const rowCells = initialAnalysis.elements.filter(
          (element) =>
            element.kind === "cell" &&
            element.sheetName === repeatBinding.sheetName &&
            element.sheetPath === repeatBinding.sheetPath &&
            xlsxCoordinate(element.address).row === repeatBinding.rowNumber
        );
        const columns = rowCells.map((element) =>
          xlsxCoordinate(element.kind === "cell" ? element.address : "").column
        );
        const startColumn = xlsxCoordinate(repeatBinding.startAddress).column;
        const endColumn = xlsxCoordinate(repeatBinding.endAddress).column;
        if (
          columns.length === 0 ||
          Math.min(...columns) !== startColumn ||
          Math.max(...columns) !== endColumn
        ) {
          throw new TemplateCompilerError(
            "repeat_used_row_mismatch",
            "Границы повтора не охватывают всю используемую строку XLSX."
          );
        }
      }
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
      existingTechnicalBindings: results.map(
        (result) => result.technicalBinding
      ),
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
      modifiedParts: compiled.modifiedParts,
      technicalBinding: compiled.technicalBinding
    });
  }

  let repeat: CompileScalarFieldsResult["repeat"] = null;
  if (repeatBinding !== null) {
    if (repeatBinding.kind === "docx.repeat-row") {
      const compiledRepeat = await compileDocxRepeatRow({
        compiled: current,
        binding: repeatBinding,
        fieldTechnicalBindings: results.map((field) => field.technicalBinding)
      });
      current = compiledRepeat.output;
      repeat = {
        binding: compiledRepeat.binding,
        technicalBinding: compiledRepeat.technicalBinding
      };
    } else {
      const resultById = new Map(results.map((field) => [field.fieldId, field]));
      const compiledRepeat = await compileXlsxRepeatRow({
        compiled: current,
        binding: repeatBinding,
        fields: normalizedFields.map((field) => {
          const compiledField = resultById.get(field.id);
          if (compiledField === undefined) {
            throw new TemplateCompilerError(
              "compiled_binding_not_found",
              "После сборки не найдена техническая привязка поля XLSX."
            );
          }
          return {
            fieldId: field.id,
            technicalBinding: compiledField.technicalBinding,
            fieldBinding: field.binding
          };
        })
      });
      current = compiledRepeat.output;
      repeat = {
        binding: compiledRepeat.binding,
        technicalBinding: compiledRepeat.technicalBinding
      };
    }
  }

  return {
    output: current,
    format: initialAnalysis.format,
    sourceSha256: sourceHash,
    structureSha256: initialAnalysis.structureSha256,
    outputSha256: sha256(current),
    modifiedParts: [
      ...new Set([
        ...results.flatMap((field) => field.modifiedParts),
        ...(repeat === null ? [] : [repeat.technicalBinding.part])
      ])
    ].sort(),
    fields: results,
    repeat,
    verification: {
      found: true,
      checkedFields: results.length,
      message:
        repeat === null
          ? `После сборки повторно найдены технические привязки: ${results.length}.`
          : `После сборки повторно найдены поля (${results.length}) и повторяемая строка.`
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
  const metadataFields = fields.filter(
    (field) => field.technicalBinding.metadataVersion === 1
  );
  const unsupportedMetadataVersion = fields.some((field) => {
    const version = (field.technicalBinding as { metadataVersion?: unknown })
      .metadataVersion;
    return version !== undefined && version !== 1;
  });
  if (unsupportedMetadataVersion) {
    throw new TemplateCompilerError(
      "technical_binding_mismatch",
      "Набор полей XLSX использует неподдерживаемую версию служебных данных."
    );
  }
  if (metadataFields.length !== 0 && metadataFields.length !== fields.length) {
    throw new TemplateCompilerError(
      "mixed_xlsx_metadata_contract",
      "Поля используют разные версии служебных данных XLSX. Повторно проверьте и активируйте шаблон."
    );
  }
  const expectedMetadataRecords =
    metadataFields.length === fields.length
      ? [
          ...fields.map((field) =>
            xlsxMetadataRecord("field", field.technicalBinding)
          ),
          ...(input.repeatTechnicalBinding === undefined
            ? []
            : [xlsxMetadataRecord("repeat", input.repeatTechnicalBinding)])
        ]
      : [];
  if (metadataFields.length === fields.length) {
    if (
      fields.some(
        (field) =>
          field.technicalBinding.kind !== "xlsx.defined-name" ||
          field.fieldBinding.kind !== "xlsx.cell"
      )
    ) {
      throw new TemplateCompilerError(
        "technical_binding_mismatch",
        "Служебные данные XLSX не соответствуют набору полей."
      );
    }
    verifyXlsxMetadata(await readOoxmlPackage(original), {
      expectedRecords: expectedMetadataRecords,
      exactExpectedRecords: true,
      definedNames: "present"
    });
  }
  let current: Buffer<ArrayBufferLike> = original;
  const rendered: RenderedScalarFieldValue[] = [];

  for (const field of fields) {
    const result = await renderScalarValue({
      compiled: current,
      technicalBinding: field.technicalBinding,
      fieldBinding: field.fieldBinding,
      valueType: field.valueType,
      value: field.value,
      formatter: field.formatter,
      ...(metadataFields.length === fields.length
        ? { expectedXlsxMetadataRecords: expectedMetadataRecords }
        : {})
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
      valueType: field.valueType,
      formatter: field.formatter,
      ...(metadataFields.length === fields.length
        ? { expectedXlsxMetadataRecords: expectedMetadataRecords }
        : {})
    });
    expected.readBackValue = readBack.value;
    if (readBack.value !== expected.renderedValue) {
      throw new TemplateCompilerError(
        "trial_value_mismatch",
        `После итоговой сборки значение поля «${field.fieldKey}» не совпало с ожидаемым.`
      );
    }
  }

  if (metadataFields.length === fields.length) {
    verifyXlsxMetadata(await readOoxmlPackage(current), {
      expectedRecords: expectedMetadataRecords,
      exactExpectedRecords: true,
      definedNames: "present"
    });
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
