import { randomUUID } from "node:crypto";

import type {
  DocumentStructureElement,
  DocumentStructureReport,
  DocxParagraphElement,
  XlsxCellElement
} from "@docomator/document-intake";
import { toJsonValue, type JsonValue } from "@docomator/storage";

export type ExtractionOutputType = "text" | "number" | "integer" | "date";

export interface ExtractionFieldRequest {
  label: string;
  elementId: string;
  outputType?: ExtractionOutputType;
}

export interface ExtractionRepeatColumnRequest extends ExtractionFieldRequest {}

export interface ExtractionRepeatRequest {
  label?: string;
  columns: readonly ExtractionRepeatColumnRequest[];
}

export interface BuildExtractionDefinitionInput {
  fields?: readonly ExtractionFieldRequest[];
  repeat?: ExtractionRepeatRequest;
}

export interface ExtractionIssue {
  code:
    | "document_format_mismatch"
    | "document_structure_truncated"
    | "selector_not_found"
    | "value_conversion_failed"
    | "repeat_rows_not_found";
  severity: "warning" | "error";
  fieldId?: string;
  fieldLabel?: string;
  rowNumber?: number;
  coordinate?: string;
  rawValue?: string;
  parameters?: Record<string, string | number | boolean | null>;
}

type ScalarSelector =
  | {
      kind: "docx.paragraph";
      part: string;
      index: number;
    }
  | {
      kind: "docx.cell";
      part: string;
      tableIndex: number;
      rowIndex: number;
      columnIndex: number;
    }
  | {
      kind: "xlsx.cell";
      sheetName: string;
      sheetPath: string;
      address: string;
    };

type RepeatSelector =
  | {
      kind: "docx.table-rows";
      part: string;
      tableIndex: number;
      startRowIndex: number;
    }
  | {
      kind: "xlsx.sheet-rows";
      sheetName: string;
      sheetPath: string;
      startRowNumber: number;
    };

export interface ExtractionFieldDefinition {
  id: string;
  label: string;
  outputType: ExtractionOutputType;
  selector: ScalarSelector;
}

export interface ExtractionRepeatColumnDefinition {
  id: string;
  label: string;
  outputType: ExtractionOutputType;
  columnIndex: number;
}

export interface ExtractionRepeatDefinition {
  id: string;
  label: string;
  selector: RepeatSelector;
  columns: ExtractionRepeatColumnDefinition[];
}

export interface DataExtractionDefinition {
  version: 1;
  format: "docx" | "xlsx";
  fields: ExtractionFieldDefinition[];
  repeat: ExtractionRepeatDefinition | null;
}

export interface ExtractedScalarValue {
  fieldId: string;
  label: string;
  value: string;
  source: string;
}

export interface ExtractedRepeatCellValue {
  columnId: string;
  label: string;
  value: string;
  source: string;
}

export interface ExtractedRepeatRow {
  rowNumber: number;
  sourceRow: number;
  cells: ExtractedRepeatCellValue[];
}

export interface DataExtractionResult {
  version: 1;
  fields: ExtractedScalarValue[];
  repeat: {
    id: string;
    label: string;
    rows: ExtractedRepeatRow[];
  } | null;
}

export class DataExtractionDefinitionError extends Error {
  override readonly name = "DataExtractionDefinitionError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new DataExtractionDefinitionError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DataExtractionDefinitionError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new DataExtractionDefinitionError(`${name} must not exceed ${maximum} characters`);
  }
  return normalized;
}

function outputType(value: string | undefined): ExtractionOutputType {
  const normalized = value ?? "text";
  if (
    normalized === "text" ||
    normalized === "number" ||
    normalized === "integer" ||
    normalized === "date"
  ) {
    return normalized;
  }
  throw new DataExtractionDefinitionError(`Unsupported extraction output type: ${normalized}`);
}

function elementById(
  structure: DocumentStructureReport,
  id: string
): DocumentStructureElement {
  const element = structure.elements.find((candidate) => candidate.id === id);
  if (element === undefined) {
    throw new DataExtractionDefinitionError(`Structure element was not found: ${id}`);
  }
  return element;
}

function xlsxCoordinate(addressValue: string): { column: number; row: number; address: string } {
  const address = addressValue.toUpperCase();
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(address);
  if (match === null) {
    throw new DataExtractionDefinitionError(`Unsupported spreadsheet address: ${addressValue}`);
  }
  let column = 0;
  for (const character of match[1] ?? "") {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { column, row: Number(match[2]), address };
}

function scalarSelector(element: DocumentStructureElement): ScalarSelector {
  if (element.kind === "cell") {
    return {
      kind: "xlsx.cell",
      sheetName: element.sheetName,
      sheetPath: element.sheetPath,
      address: element.address.toUpperCase()
    };
  }
  if (element.tableLocation !== null) {
    return {
      kind: "docx.cell",
      part: element.part,
      tableIndex: element.tableLocation.tableIndex,
      rowIndex: element.tableLocation.rowIndex,
      columnIndex: element.tableLocation.columnIndex
    };
  }
  return {
    kind: "docx.paragraph",
    part: element.part,
    index: element.index
  };
}

function fieldDefinition(
  structure: DocumentStructureReport,
  request: ExtractionFieldRequest
): ExtractionFieldDefinition {
  const elementId = requiredText(request.elementId, "elementId", 160);
  return {
    id: randomUUID(),
    label: requiredText(request.label, "label", 200),
    outputType: outputType(request.outputType),
    selector: scalarSelector(elementById(structure, elementId))
  };
}

function repeatDefinition(
  structure: DocumentStructureReport,
  request: ExtractionRepeatRequest
): ExtractionRepeatDefinition {
  if (!Array.isArray(request.columns) || request.columns.length < 1 || request.columns.length > 30) {
    throw new DataExtractionDefinitionError("repeat.columns must contain between 1 and 30 columns");
  }
  const elements = request.columns.map((column) =>
    elementById(structure, requiredText(column.elementId, "elementId", 160))
  );
  if (new Set(elements.map((element) => element.id)).size !== elements.length) {
    throw new DataExtractionDefinitionError("repeat columns must refer to different elements");
  }

  let selector: RepeatSelector;
  let columnIndexes: number[];
  if (structure.format === "docx") {
    if (elements.some((element) => element.kind !== "paragraph" || element.tableLocation === null)) {
      throw new DataExtractionDefinitionError(
        "DOCX repeated extraction can use only cells from one table row"
      );
    }
    const first = elements[0] as DocxParagraphElement;
    const firstLocation = first.tableLocation!;
    for (const element of elements as DocxParagraphElement[]) {
      const location = element.tableLocation!;
      if (
        element.part !== first.part ||
        location.tableIndex !== firstLocation.tableIndex ||
        location.rowIndex !== firstLocation.rowIndex
      ) {
        throw new DataExtractionDefinitionError(
          "DOCX repeated extraction columns must belong to one table row"
        );
      }
    }
    selector = {
      kind: "docx.table-rows",
      part: first.part,
      tableIndex: firstLocation.tableIndex,
      startRowIndex: firstLocation.rowIndex
    };
    columnIndexes = (elements as DocxParagraphElement[]).map(
      (element) => element.tableLocation!.columnIndex
    );
  } else {
    if (elements.some((element) => element.kind !== "cell")) {
      throw new DataExtractionDefinitionError(
        "XLSX repeated extraction can use only cells from one spreadsheet row"
      );
    }
    const cells = elements as XlsxCellElement[];
    const first = cells[0]!;
    const firstCoordinate = xlsxCoordinate(first.address);
    for (const cell of cells) {
      const coordinate = xlsxCoordinate(cell.address);
      if (
        cell.sheetName !== first.sheetName ||
        cell.sheetPath !== first.sheetPath ||
        coordinate.row !== firstCoordinate.row
      ) {
        throw new DataExtractionDefinitionError(
          "XLSX repeated extraction columns must belong to one spreadsheet row"
        );
      }
    }
    selector = {
      kind: "xlsx.sheet-rows",
      sheetName: first.sheetName,
      sheetPath: first.sheetPath,
      startRowNumber: firstCoordinate.row
    };
    columnIndexes = cells.map((cell) => xlsxCoordinate(cell.address).column);
  }

  if (new Set(columnIndexes).size !== columnIndexes.length) {
    throw new DataExtractionDefinitionError("repeat columns must use different columns");
  }

  return {
    id: randomUUID(),
    label: requiredText(request.label ?? "Строки", "repeat.label", 200),
    selector,
    columns: request.columns.map((column, index) => ({
      id: randomUUID(),
      label: requiredText(column.label, "repeat.column.label", 200),
      outputType: outputType(column.outputType),
      columnIndex: columnIndexes[index]!
    }))
  };
}

export function buildDataExtractionDefinition(
  structure: DocumentStructureReport,
  input: BuildExtractionDefinitionInput
): DataExtractionDefinition {
  if (structure.truncated) {
    throw new DataExtractionDefinitionError(
      "Нельзя сохранить шаблон извлечения по усечённой структуре. Уменьшите документ или разделите его."
    );
  }
  const requestedFields = input.fields ?? [];
  if (requestedFields.length > 50) {
    throw new DataExtractionDefinitionError("Extraction template supports at most 50 scalar fields");
  }
  if (requestedFields.length === 0 && input.repeat === undefined) {
    throw new DataExtractionDefinitionError(
      "Выберите хотя бы одно поле или строку таблицы для извлечения."
    );
  }
  const fields = requestedFields.map((request) => fieldDefinition(structure, request));
  const repeat = input.repeat === undefined ? null : repeatDefinition(structure, input.repeat);
  return {
    version: 1,
    format: structure.format,
    fields,
    repeat
  };
}

function coordinateForSelector(selector: ScalarSelector): string {
  if (selector.kind === "docx.paragraph") return `${selector.part}#p${selector.index + 1}`;
  if (selector.kind === "docx.cell") {
    return `${selector.part}#table${selector.tableIndex + 1}:r${selector.rowIndex + 1}:c${selector.columnIndex + 1}`;
  }
  return `${selector.sheetName}!${selector.address}`;
}

function docxCellText(
  structure: DocumentStructureReport,
  selector: Extract<ScalarSelector, { kind: "docx.cell" }>
): string | null {
  const paragraphs = structure.elements.filter(
    (element): element is DocxParagraphElement =>
      element.kind === "paragraph" &&
      element.part === selector.part &&
      element.tableLocation !== null &&
      element.tableLocation.tableIndex === selector.tableIndex &&
      element.tableLocation.rowIndex === selector.rowIndex &&
      element.tableLocation.columnIndex === selector.columnIndex
  );
  if (paragraphs.length === 0) return null;
  return paragraphs.map((paragraph) => paragraph.text).join("\n").trim();
}

function rawScalarValue(
  structure: DocumentStructureReport,
  selector: ScalarSelector
): string | null {
  if (selector.kind === "docx.paragraph") {
    const element = structure.elements.find(
      (candidate): candidate is DocxParagraphElement =>
        candidate.kind === "paragraph" &&
        candidate.part === selector.part &&
        candidate.index === selector.index
    );
    return element?.text ?? null;
  }
  if (selector.kind === "docx.cell") return docxCellText(structure, selector);
  const element = structure.elements.find(
    (candidate): candidate is XlsxCellElement =>
      candidate.kind === "cell" &&
      candidate.sheetName === selector.sheetName &&
      candidate.sheetPath === selector.sheetPath &&
      candidate.address.toUpperCase() === selector.address
  );
  return element?.value ?? null;
}

function excelSerialDate(raw: string): string | null {
  if (!/^\d+(?:[.,]\d+)?$/u.test(raw.trim())) return null;
  const serial = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const milliseconds = Math.round((serial - 25_569) * 86_400_000);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizedDate(raw: string, allowExcelSerial: boolean): string | null {
  const value = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const ru = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/u.exec(value);
  const year = Number(iso?.[1] ?? ru?.[3]);
  const month = Number(iso?.[2] ?? ru?.[2]);
  const day = Number(iso?.[3] ?? ru?.[1]);
  if (iso !== null || ru !== null) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
    ) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }
  return allowExcelSerial ? excelSerialDate(value) : null;
}

function normalizeValue(
  raw: string,
  type: ExtractionOutputType,
  allowExcelSerial: boolean
): { value: string; valid: boolean } {
  const value = raw.trim();
  if (type === "text") return { value, valid: true };
  if (type === "date") {
    const date = normalizedDate(value, allowExcelSerial);
    return date === null ? { value, valid: value === "" } : { value: date, valid: true };
  }
  const compact = value.replace(/[\s\u00a0]/gu, "").replace(",", ".");
  if (compact === "") return { value: "", valid: true };
  if (type === "integer") {
    return /^[-+]?\d+$/u.test(compact)
      ? { value: String(Number.parseInt(compact, 10)), valid: true }
      : { value, valid: false };
  }
  return /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(compact) && Number.isFinite(Number(compact))
    ? { value: String(Number(compact)), valid: true }
    : { value, valid: false };
}

function conversionIssue(
  fieldId: string,
  label: string,
  output: ExtractionOutputType,
  coordinate: string,
  rawValue: string,
  rowNumber?: number
): ExtractionIssue {
  return {
    code: "value_conversion_failed",
    severity: "error",
    fieldId,
    fieldLabel: label,
    ...(rowNumber === undefined ? {} : { rowNumber }),
    coordinate,
    rawValue,
    parameters: { outputType: output }
  };
}

function extractFields(
  structure: DocumentStructureReport,
  definition: DataExtractionDefinition,
  issues: ExtractionIssue[]
): ExtractedScalarValue[] {
  return definition.fields.map((field) => {
    const coordinate = coordinateForSelector(field.selector);
    const raw = rawScalarValue(structure, field.selector);
    if (raw === null) {
      issues.push({
        code: "selector_not_found",
        severity: "error",
        fieldId: field.id,
        fieldLabel: field.label,
        coordinate
      });
      return { fieldId: field.id, label: field.label, value: "", source: coordinate };
    }
    const normalized = normalizeValue(raw, field.outputType, field.selector.kind === "xlsx.cell");
    if (!normalized.valid) {
      issues.push(conversionIssue(field.id, field.label, field.outputType, coordinate, raw));
    }
    return {
      fieldId: field.id,
      label: field.label,
      value: normalized.value,
      source: coordinate
    };
  });
}

function extractDocxRepeat(
  structure: DocumentStructureReport,
  repeat: ExtractionRepeatDefinition,
  selector: Extract<RepeatSelector, { kind: "docx.table-rows" }>,
  issues: ExtractionIssue[]
): ExtractedRepeatRow[] {
  const rowIndexes = new Set<number>();
  for (const element of structure.elements) {
    if (
      element.kind === "paragraph" &&
      element.part === selector.part &&
      element.tableLocation !== null &&
      element.tableLocation.tableIndex === selector.tableIndex &&
      element.tableLocation.rowIndex >= selector.startRowIndex
    ) {
      rowIndexes.add(element.tableLocation.rowIndex);
    }
  }
  const rows: ExtractedRepeatRow[] = [];
  for (const sourceRow of [...rowIndexes].sort((left, right) => left - right)) {
    const cells = repeat.columns.map((column) => {
      const scalar: Extract<ScalarSelector, { kind: "docx.cell" }> = {
        kind: "docx.cell",
        part: selector.part,
        tableIndex: selector.tableIndex,
        rowIndex: sourceRow,
        columnIndex: column.columnIndex
      };
      const coordinate = coordinateForSelector(scalar);
      const raw = docxCellText(structure, scalar) ?? "";
      const normalized = normalizeValue(raw, column.outputType, false);
      if (!normalized.valid) {
        issues.push(
          conversionIssue(
            column.id,
            column.label,
            column.outputType,
            coordinate,
            raw,
            rows.length + 1
          )
        );
      }
      return {
        columnId: column.id,
        label: column.label,
        value: normalized.value,
        source: coordinate
      };
    });
    if (cells.some((cell) => cell.value !== "")) {
      rows.push({ rowNumber: rows.length + 1, sourceRow: sourceRow + 1, cells });
    }
  }
  return rows;
}

function xlsxColumnAddress(column: number, row: number): string {
  let current = column;
  let letters = "";
  while (current > 0) {
    current -= 1;
    letters = String.fromCharCode(65 + (current % 26)) + letters;
    current = Math.floor(current / 26);
  }
  return `${letters}${row}`;
}

function extractXlsxRepeat(
  structure: DocumentStructureReport,
  repeat: ExtractionRepeatDefinition,
  selector: Extract<RepeatSelector, { kind: "xlsx.sheet-rows" }>,
  issues: ExtractionIssue[]
): ExtractedRepeatRow[] {
  const cells = structure.elements.filter(
    (element): element is XlsxCellElement =>
      element.kind === "cell" &&
      element.sheetName === selector.sheetName &&
      element.sheetPath === selector.sheetPath
  );
  const byAddress = new Map(cells.map((cell) => [cell.address.toUpperCase(), cell]));
  const rowNumbers = new Set<number>();
  for (const cell of cells) {
    const coordinate = xlsxCoordinate(cell.address);
    if (coordinate.row >= selector.startRowNumber) rowNumbers.add(coordinate.row);
  }
  const rows: ExtractedRepeatRow[] = [];
  for (const sourceRow of [...rowNumbers].sort((left, right) => left - right)) {
    const outputCells = repeat.columns.map((column) => {
      const address = xlsxColumnAddress(column.columnIndex, sourceRow);
      const raw = byAddress.get(address)?.value ?? "";
      const normalized = normalizeValue(raw, column.outputType, true);
      if (!normalized.valid) {
        issues.push(
          conversionIssue(
            column.id,
            column.label,
            column.outputType,
            `${selector.sheetName}!${address}`,
            raw,
            rows.length + 1
          )
        );
      }
      return {
        columnId: column.id,
        label: column.label,
        value: normalized.value,
        source: `${selector.sheetName}!${address}`
      };
    });
    if (outputCells.some((cell) => cell.value !== "")) {
      rows.push({ rowNumber: rows.length + 1, sourceRow, cells: outputCells });
    }
  }
  return rows;
}

export function extractDataFromStructure(
  structure: DocumentStructureReport,
  definition: DataExtractionDefinition
): { result: DataExtractionResult; issues: ExtractionIssue[] } {
  const issues: ExtractionIssue[] = [];
  if (structure.format !== definition.format) {
    issues.push({
      code: "document_format_mismatch",
      severity: "error",
      parameters: { expected: definition.format, actual: structure.format }
    });
    return {
      result: { version: 1, fields: [], repeat: null },
      issues
    };
  }
  if (structure.truncated) {
    issues.push({
      code: "document_structure_truncated",
      severity: "error",
      parameters: {
        shownElements: structure.summary.shownElements,
        totalElements: structure.summary.totalElements
      }
    });
  }
  const fields = extractFields(structure, definition, issues);
  let repeatResult: DataExtractionResult["repeat"] = null;
  if (definition.repeat !== null) {
    const rows = definition.repeat.selector.kind === "docx.table-rows"
      ? extractDocxRepeat(structure, definition.repeat, definition.repeat.selector, issues)
      : extractXlsxRepeat(structure, definition.repeat, definition.repeat.selector, issues);
    if (rows.length === 0) {
      issues.push({
        code: "repeat_rows_not_found",
        severity: "warning",
        parameters: { repeatId: definition.repeat.id }
      });
    }
    repeatResult = {
      id: definition.repeat.id,
      label: definition.repeat.label,
      rows
    };
  }
  return { result: { version: 1, fields, repeat: repeatResult }, issues };
}

function jsonRecord(value: JsonValue): Record<string, JsonValue> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

export function applyExtractionCorrections(
  result: DataExtractionResult,
  correctionsValue: JsonValue
): DataExtractionResult {
  const corrections = jsonRecord(correctionsValue) ?? {};
  const fieldCorrections = jsonRecord(corrections.fields ?? null) ?? {};
  const repeatCorrections = jsonRecord(corrections.repeat ?? null) ?? {};
  return {
    version: 1,
    fields: result.fields.map((field) => ({
      ...field,
      value:
        typeof fieldCorrections[field.fieldId] === "string"
          ? fieldCorrections[field.fieldId] as string
          : field.value
    })),
    repeat:
      result.repeat === null
        ? null
        : {
            ...result.repeat,
            rows: result.repeat.rows.map((row) => {
              const rowCorrections = jsonRecord(repeatCorrections[String(row.rowNumber)] ?? null) ?? {};
              return {
                ...row,
                cells: row.cells.map((cell) => ({
                  ...cell,
                  value:
                    typeof rowCorrections[cell.columnId] === "string"
                      ? rowCorrections[cell.columnId] as string
                      : cell.value
                }))
              };
            })
          }
  };
}

export function validateExtractionCorrections(
  result: DataExtractionResult,
  correctionsValue: JsonValue
): JsonValue {
  const corrections = jsonRecord(toJsonValue(correctionsValue));
  if (corrections === null) {
    throw new DataExtractionDefinitionError("corrections must be a JSON object");
  }
  const allowedTop = new Set(["fields", "repeat"]);
  if (Object.keys(corrections).some((key) => !allowedTop.has(key))) {
    throw new DataExtractionDefinitionError("corrections contains an unknown section");
  }
  const fields = jsonRecord(corrections.fields ?? {}) ?? null;
  if (fields === null) throw new DataExtractionDefinitionError("corrections.fields must be an object");
  const fieldIds = new Set(result.fields.map((field) => field.fieldId));
  for (const [key, value] of Object.entries(fields)) {
    if (!fieldIds.has(key) || typeof value !== "string" || value.length > 20_000) {
      throw new DataExtractionDefinitionError("corrections.fields contains an invalid value");
    }
  }
  const repeat = jsonRecord(corrections.repeat ?? {}) ?? null;
  if (repeat === null) throw new DataExtractionDefinitionError("corrections.repeat must be an object");
  const rows = new Map((result.repeat?.rows ?? []).map((row) => [String(row.rowNumber), row]));
  for (const [rowKey, rowValue] of Object.entries(repeat)) {
    const row = rows.get(rowKey);
    const rowCorrections = jsonRecord(rowValue);
    if (row === undefined || rowCorrections === null) {
      throw new DataExtractionDefinitionError("corrections.repeat contains an unknown row");
    }
    const columnIds = new Set(row.cells.map((cell) => cell.columnId));
    for (const [columnId, value] of Object.entries(rowCorrections)) {
      if (!columnIds.has(columnId) || typeof value !== "string" || value.length > 20_000) {
        throw new DataExtractionDefinitionError("corrections.repeat contains an invalid cell");
      }
    }
  }
  return toJsonValue(corrections);
}

function csvValue(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/gu, '""')}"`;
}

export function dataExtractionCsv(
  run: {
    templateSnapshot: JsonValue;
    items: readonly {
      sourceName: string;
      result: JsonValue;
      corrections: JsonValue;
    }[];
  }
): string {
  const definition = run.templateSnapshot as unknown as DataExtractionDefinition;
  if (definition?.version !== 1 || !Array.isArray(definition.fields)) {
    throw new DataExtractionDefinitionError("Stored extraction template snapshot is invalid");
  }
  const scalarHeaders = definition.fields.map((field) => field.label);
  const repeatHeaders = definition.repeat?.columns.map((column) => column.label) ?? [];
  const headers = [
    "Исходный документ",
    ...scalarHeaders,
    ...(definition.repeat === null ? [] : ["№ строки"]),
    ...repeatHeaders
  ];
  const lines = [headers.map(csvValue).join(",")];
  for (const item of run.items) {
    const result = item.result as unknown as DataExtractionResult;
    const corrected = applyExtractionCorrections(result, item.corrections);
    const scalarValues = definition.fields.map(
      (field) => corrected.fields.find((value) => value.fieldId === field.id)?.value ?? ""
    );
    if (definition.repeat === null) {
      lines.push([item.sourceName, ...scalarValues].map(csvValue).join(","));
      continue;
    }
    const rows = corrected.repeat?.rows ?? [];
    if (rows.length === 0) {
      lines.push(
        [item.sourceName, ...scalarValues, "", ...repeatHeaders.map(() => "")]
          .map(csvValue)
          .join(",")
      );
      continue;
    }
    for (const row of rows) {
      const repeatValues = definition.repeat.columns.map(
        (column) => row.cells.find((cell) => cell.columnId === column.id)?.value ?? ""
      );
      lines.push(
        [item.sourceName, ...scalarValues, String(row.rowNumber), ...repeatValues]
          .map(csvValue)
          .join(",")
      );
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
