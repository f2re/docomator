import { createHash } from "node:crypto";

import {
  compileDocxRepeatRow,
  type CompiledRepeatTechnicalBinding,
  type CompiledTechnicalBinding,
  type CompileScalarFieldDefinition,
  type DocxRepeatRowBinding,
  type ScalarFieldBinding
} from "./compiler.js";
import { TemplateCompilerError } from "./errors.js";
import {
  compileScalarFields,
  renderScalarValues,
  type CompiledScalarFieldResult,
  type RenderedScalarFieldValue
} from "./multi-field.js";
import {
  renderDocxRepeatRows,
  type ScalarValueType
} from "./scalar-render.js";
import { formatScalarDisplay } from "./scalar-formatter.js";

export interface EntityCollectionDocxRepeatSource {
  anchorElementId: string;
  part: string;
  tableIndex: number;
  rowIndex: number;
}

export interface CompileEntityCollectionDocxInput {
  source: Uint8Array;
  fileName: string;
  expectedSourceSha256: string;
  expectedStructureSha256: string;
  fields: readonly CompileScalarFieldDefinition[];
  repeat: EntityCollectionDocxRepeatSource;
}

export interface CompileEntityCollectionDocxResult {
  output: Buffer;
  sourceSha256: string;
  structureSha256: string;
  outputSha256: string;
  modifiedParts: string[];
  fields: CompiledScalarFieldResult[];
  repeat: {
    binding: DocxRepeatRowBinding;
    technicalBinding: CompiledRepeatTechnicalBinding;
  };
  rowFieldIds: string[];
  scalarFieldIds: string[];
  verification: {
    found: true;
    checkedFields: number;
    repeatFieldCount: number;
    message: string;
  };
}

export interface RenderEntityCollectionTrialField {
  fieldId: string;
  fieldKey: string;
  required: boolean;
  technicalBinding: CompiledTechnicalBinding;
  fieldBinding: ScalarFieldBinding;
  valueType: ScalarValueType;
  value: string | number | boolean;
  formatter?: unknown;
}

export interface RenderEntityCollectionDocxTrialInput {
  compiled: Uint8Array;
  repeat: {
    binding: DocxRepeatRowBinding;
    technicalBinding: CompiledRepeatTechnicalBinding;
  };
  fields: readonly RenderEntityCollectionTrialField[];
}

export interface RenderEntityCollectionDocxTrialResult {
  output: Buffer;
  inputSha256: string;
  outputSha256: string;
  modifiedParts: string[];
  fields: RenderedScalarFieldValue[];
  rowFieldIds: string[];
  scalarFieldIds: string[];
  verification: {
    matched: true;
    checkedFields: number;
    repeatCheckedValues: number;
    message: string;
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function tableLocation(binding: unknown): {
  part: string;
  tableIndex: number;
  rowIndex: number;
} | null {
  if (typeof binding !== "object" || binding === null || Array.isArray(binding)) return null;
  const record = binding as Record<string, unknown>;
  if (typeof record.part !== "string") return null;
  const raw = record.tableLocation;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const location = raw as Record<string, unknown>;
  if (
    typeof location.tableIndex !== "number" ||
    !Number.isInteger(location.tableIndex) ||
    location.tableIndex < 0 ||
    typeof location.rowIndex !== "number" ||
    !Number.isInteger(location.rowIndex) ||
    location.rowIndex < 0
  ) {
    return null;
  }
  return {
    part: record.part,
    tableIndex: location.tableIndex,
    rowIndex: location.rowIndex
  };
}

function sameRow(
  binding: unknown,
  repeat: Pick<EntityCollectionDocxRepeatSource, "part" | "tableIndex" | "rowIndex">
): boolean {
  const location = tableLocation(binding);
  return Boolean(
    location &&
      location.part === repeat.part &&
      location.tableIndex === repeat.tableIndex &&
      location.rowIndex === repeat.rowIndex
  );
}

function normalizeRepeat(
  repeat: EntityCollectionDocxRepeatSource
): DocxRepeatRowBinding {
  if (
    typeof repeat.anchorElementId !== "string" ||
    repeat.anchorElementId.trim().length === 0 ||
    typeof repeat.part !== "string" ||
    repeat.part.trim().length === 0 ||
    !Number.isInteger(repeat.tableIndex) ||
    repeat.tableIndex < 0 ||
    !Number.isInteger(repeat.rowIndex) ||
    repeat.rowIndex < 0
  ) {
    throw new TemplateCompilerError(
      "invalid_repeat_binding",
      "Координаты повторяемой строки имеют недопустимый формат."
    );
  }
  return {
    version: 1,
    kind: "docx.repeat-row",
    source: "audience.members",
    anchorElementId: repeat.anchorElementId.trim(),
    part: repeat.part.trim(),
    tableIndex: repeat.tableIndex,
    rowIndex: repeat.rowIndex
  };
}

function partitionFields<
  T extends { fieldBinding?: unknown; binding?: unknown }
>(
  fields: readonly T[],
  repeat: EntityCollectionDocxRepeatSource
): { row: T[]; scalar: T[] } {
  const row: T[] = [];
  const scalar: T[] = [];
  for (const field of fields) {
    if (sameRow(field.fieldBinding ?? field.binding, repeat)) row.push(field);
    else scalar.push(field);
  }
  if (row.length === 0) {
    throw new TemplateCompilerError(
      "repeat_row_has_no_fields",
      "В выбранной повторяемой строке не найдено ни одного сохранённого поля."
    );
  }
  return { row, scalar };
}

export async function compileEntityCollectionDocx(
  input: CompileEntityCollectionDocxInput
): Promise<CompileEntityCollectionDocxResult> {
  if (!input.fileName.toLocaleLowerCase("ru-RU").endsWith(".docx")) {
    throw new TemplateCompilerError(
      "unsupported_repeat_format",
      "Повторяемая таблица из карточки сотрудника в этой версии поддерживается только в DOCX."
    );
  }
  const partition = partitionFields(input.fields, input.repeat);
  const compiled = await compileScalarFields({
    source: input.source,
    fileName: input.fileName,
    expectedSourceSha256: input.expectedSourceSha256,
    expectedStructureSha256: input.expectedStructureSha256,
    fields: input.fields
  });
  if (compiled.format !== "docx") {
    throw new TemplateCompilerError(
      "unsupported_repeat_format",
      "Повторяемая таблица из карточки сотрудника в этой версии поддерживается только в DOCX."
    );
  }
  const rowIds = new Set(partition.row.map((field) => field.id));
  const rowCompiled = compiled.fields.filter((field) => rowIds.has(field.fieldId));
  if (rowCompiled.length !== partition.row.length) {
    throw new TemplateCompilerError(
      "repeat_row_field_mismatch",
      "Не удалось однозначно сопоставить поля повторяемой строки после компиляции."
    );
  }
  const binding = normalizeRepeat(input.repeat);
  const repeat = await compileDocxRepeatRow({
    compiled: compiled.output,
    binding,
    fieldTechnicalBindings: rowCompiled.map((field) => field.technicalBinding)
  });
  const modifiedParts = [
    ...new Set([...compiled.modifiedParts, repeat.modifiedPart])
  ].sort();
  return {
    output: repeat.output,
    sourceSha256: compiled.sourceSha256,
    structureSha256: compiled.structureSha256,
    outputSha256: repeat.outputSha256,
    modifiedParts,
    fields: compiled.fields,
    repeat: {
      binding: repeat.binding,
      technicalBinding: repeat.technicalBinding
    },
    rowFieldIds: partition.row.map((field) => field.id),
    scalarFieldIds: partition.scalar.map((field) => field.id),
    verification: {
      found: true,
      checkedFields: compiled.verification.checkedFields,
      repeatFieldCount: repeat.verification.fieldCount,
      message: "Скалярные поля и повторяемая строка DOCX проверены после компиляции."
    }
  };
}

export async function renderEntityCollectionDocxTrial(
  input: RenderEntityCollectionDocxTrialInput
): Promise<RenderEntityCollectionDocxTrialResult> {
  const repeatSource: EntityCollectionDocxRepeatSource = {
    anchorElementId: input.repeat.binding.anchorElementId,
    part: input.repeat.binding.part,
    tableIndex: input.repeat.binding.tableIndex,
    rowIndex: input.repeat.binding.rowIndex
  };
  const partition = partitionFields(input.fields, repeatSource);
  let intermediate: Uint8Array = input.compiled;
  const scalarResults: RenderedScalarFieldValue[] = [];
  const modifiedParts = new Set<string>();

  if (partition.scalar.length > 0) {
    const scalar = await renderScalarValues({
      compiled: intermediate,
      fields: partition.scalar
    });
    intermediate = scalar.output;
    for (const part of scalar.modifiedParts) modifiedParts.add(part);
    scalarResults.push(...scalar.fields);
  }

  const repeatRendered = await renderDocxRepeatRows({
    compiled: intermediate,
    binding: input.repeat.binding,
    technicalBinding: input.repeat.technicalBinding,
    fields: partition.row.map((field) => ({
      fieldId: field.fieldId,
      fieldKey: field.fieldKey,
      required: field.required,
      technicalBinding: field.technicalBinding,
      fieldBinding: field.fieldBinding,
      valueType: field.valueType,
      formatter: field.formatter
    })),
    members: [
      {
        memberId: "entity-collection-trial-row-1",
        values: partition.row.map((field) => field.value)
      }
    ]
  });
  modifiedParts.add(repeatRendered.modifiedPart);

  const rowResults: RenderedScalarFieldValue[] = partition.row.map((field) => {
    const renderedValue = formatScalarDisplay(
      field.valueType,
      field.value,
      field.formatter
    );
    return {
      fieldId: field.fieldId,
      fieldKey: field.fieldKey,
      renderedValue,
      readBackValue: renderedValue,
      modifiedPart: repeatRendered.modifiedPart,
      technicalBinding: field.technicalBinding
    };
  });
  const byId = new Map(
    [...scalarResults, ...rowResults].map((field) => [field.fieldId, field])
  );
  const ordered = input.fields.map((field) => {
    const result = byId.get(field.fieldId);
    if (result === undefined) {
      throw new TemplateCompilerError(
        "trial_field_result_missing",
        `Не найден результат проверки поля «${field.fieldKey}».`
      );
    }
    return result;
  });

  return {
    output: repeatRendered.output,
    inputSha256: sha256(input.compiled),
    outputSha256: repeatRendered.outputSha256,
    modifiedParts: [...modifiedParts].sort(),
    fields: ordered,
    rowFieldIds: partition.row.map((field) => field.fieldId),
    scalarFieldIds: partition.scalar.map((field) => field.fieldId),
    verification: {
      matched: true,
      checkedFields: ordered.length,
      repeatCheckedValues: repeatRendered.verification.checkedValues,
      message: "Пробное заполнение проверило обычные поля и одну строку повторяемой таблицы."
    }
  };
}
