export const DATA_IMPORT_ERROR_CODES = [
  "required_value_missing",
  "duplicate_identity",
  "invalid_number",
  "invalid_integer",
  "invalid_boolean",
  "invalid_date",
  "invalid_datetime",
  "invalid_person_name",
  "property_value_invalid",
  "row_validation_failed",
  "legacy_row_validation_failed"
] as const;

export type DataImportErrorCode = (typeof DATA_IMPORT_ERROR_CODES)[number];
export type DataImportIssueSeverity = "error" | "warning";

export const DATA_IMPORT_OPERATION_ERROR_CODES = [
  "unsupported_import_format",
  "unsupported_legacy_xls",
  "import_file_empty",
  "import_file_too_large",
  "import_structure_invalid",
  "csv_invalid_encoding",
  "csv_unclosed_quote",
  "csv_too_many_rows",
  "xlsx_invalid_container",
  "xlsx_unsafe_content",
  "xlsx_worksheet_missing",
  "xlsx_structure_invalid",
  "xlsx_too_many_rows",
  "mapping_invalid",
  "mapping_ambiguous",
  "mapping_type_mismatch",
  "mapping_duplicate_target",
  "mapping_target_missing"
] as const;

export type DataImportOperationErrorCode =
  (typeof DATA_IMPORT_OPERATION_ERROR_CODES)[number];
export type DataImportIssueScope = "file" | "mapping" | "row" | "cell";
export type DataImportBlockingEffect = "file" | "mapping" | "row" | "none";

export interface DataImportOperationRepair {
  kind: "replace_file" | "choose_mapping" | "change_field_type" | "review_mapping";
  column?: string;
  propertyKey?: string;
  acceptedFormats?: string[];
}

export interface DataImportOperationIssue {
  code: DataImportOperationErrorCode;
  scope: "file" | "mapping";
  blockingEffect: "file" | "mapping";
  severity: DataImportIssueSeverity;
  message: string;
  suggestedAction: string;
  column?: string;
  propertyKey?: string;
  rawValue?: string;
  repair: DataImportOperationRepair;
}

export interface DataImportOperationIssueInput
  extends Omit<DataImportOperationIssue, "severity" | "repair"> {
  severity?: DataImportIssueSeverity;
  repair?: DataImportOperationRepair;
}

export function dataImportOperationIssue(
  input: DataImportOperationIssueInput
): DataImportOperationIssue {
  const repair =
    input.repair ??
    (input.scope === "file"
      ? { kind: "replace_file" as const, acceptedFormats: ["CSV", "XLSX"] }
      : input.code === "mapping_type_mismatch"
        ? {
            kind: "change_field_type" as const,
            ...(input.column === undefined ? {} : { column: input.column }),
            ...(input.propertyKey === undefined
              ? {}
              : { propertyKey: input.propertyKey })
          }
        : {
            kind: "choose_mapping" as const,
            ...(input.column === undefined ? {} : { column: input.column }),
            ...(input.propertyKey === undefined
              ? {}
              : { propertyKey: input.propertyKey })
          });
  return {
    code: input.code,
    scope: input.scope,
    blockingEffect: input.blockingEffect,
    severity: input.severity ?? "error",
    message: input.message,
    suggestedAction: input.suggestedAction,
    ...(input.column === undefined ? {} : { column: input.column }),
    ...(input.propertyKey === undefined ? {} : { propertyKey: input.propertyKey }),
    ...(input.rawValue === undefined ? {} : { rawValue: input.rawValue }),
    repair
  };
}
export type DataImportRepairKind =
  | "edit_cell"
  | "choose_identity_column"
  | "change_field_type"
  | "review_row";

export interface DataImportRepair {
  kind: DataImportRepairKind;
  column?: string;
  propertyKey?: string;
  acceptedFormats?: string[];
}

export interface DataImportRowError {
  rowNumber: number;
  externalKey: string | null;
  code: DataImportErrorCode;
  scope: "row" | "cell";
  blockingEffect: "row";
  message: string;
  column?: string;
  propertyKey?: string;
  rawValue?: string;
  severity: DataImportIssueSeverity;
  suggestedAction: string;
  repair: DataImportRepair;
}

export interface DataImportRowIssueInput {
  rowNumber: number;
  externalKey: string | null;
  code: DataImportErrorCode;
  message: string;
  column?: string;
  propertyKey?: string;
  rawValue?: string;
  severity?: DataImportIssueSeverity;
  repair?: DataImportRepair;
}

export function dataImportSuggestedAction(code: DataImportErrorCode): string {
  switch (code) {
    case "required_value_missing":
      return "Заполните обязательную ячейку либо выберите другую колонку для названия или устойчивого идентификатора.";
    case "duplicate_identity":
      return "Исправьте повтор в исходной таблице или выберите колонку, где значения действительно уникальны.";
    case "invalid_integer":
    case "invalid_number":
      return "Если это код или номер, выберите текстовый тип. Если это число — исправьте значение в таблице.";
    case "invalid_date":
    case "invalid_datetime":
      return "Приведите значение к формату даты или времени либо выберите текстовый тип, если колонка не является датой.";
    case "invalid_boolean":
      return "Используйте да/нет, 1/0, true/false или +/− либо выберите текстовый тип поля.";
    case "invalid_person_name":
      return "Проверьте порядок ФИО или отключите разделение ФИО для этой строки.";
    case "property_value_invalid":
      return "Проверьте значение и правила выбранного поля. Если данные имеют другой смысл, выберите подходящее поле или тип.";
    case "legacy_row_validation_failed":
      return "Проверьте исходную строку и сопоставление полей. Эта запись создана старой версией и не содержит точных координат ошибки.";
    default:
      return "Проверьте исходную строку и сопоставление полей, затем снова запустите предварительную проверку.";
  }
}

function defaultRepair(input: DataImportRowIssueInput): DataImportRepair {
  if (input.code === "duplicate_identity") {
    return {
      kind: "choose_identity_column",
      ...(input.column === undefined ? {} : { column: input.column })
    };
  }
  if (input.code === "invalid_number" || input.code === "invalid_integer") {
    return {
      kind: "change_field_type",
      ...(input.column === undefined ? {} : { column: input.column }),
      ...(input.propertyKey === undefined ? {} : { propertyKey: input.propertyKey })
    };
  }
  if (
    input.code === "required_value_missing" ||
    input.code === "invalid_boolean" ||
    input.code === "invalid_date" ||
    input.code === "invalid_datetime" ||
    input.code === "invalid_person_name" ||
    input.code === "property_value_invalid"
  ) {
    return {
      kind: "edit_cell",
      ...(input.column === undefined ? {} : { column: input.column }),
      ...(input.propertyKey === undefined ? {} : { propertyKey: input.propertyKey }),
      ...(input.code === "invalid_date"
        ? { acceptedFormats: ["YYYY-MM-DD", "DD.MM.YYYY"] }
        : input.code === "invalid_boolean"
          ? { acceptedFormats: ["да/нет", "1/0", "true/false", "+/−"] }
          : {})
    };
  }
  return { kind: "review_row" };
}

export function dataImportRowIssue(input: DataImportRowIssueInput): DataImportRowError {
  return {
    rowNumber: input.rowNumber,
    externalKey: input.externalKey,
    code: input.code,
    scope: input.column === undefined ? "row" : "cell",
    blockingEffect: "row",
    message: input.message,
    ...(input.column === undefined ? {} : { column: input.column }),
    ...(input.propertyKey === undefined ? {} : { propertyKey: input.propertyKey }),
    ...(input.rawValue === undefined ? {} : { rawValue: input.rawValue }),
    severity: input.severity ?? "error",
    suggestedAction: dataImportSuggestedAction(input.code),
    repair: input.repair ?? defaultRepair(input)
  };
}

export class DataImportCellError extends Error {
  override readonly name = "DataImportCellError";

  constructor(
    readonly code: DataImportErrorCode,
    message: string,
    readonly column: string,
    readonly propertyKey: string,
    readonly rawValue: string
  ) {
    super(message);
  }
}

export function storedDataImportRowError(value: unknown): DataImportRowError | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const rowNumber = Number(candidate.rowNumber);
  if (!Number.isInteger(rowNumber) || rowNumber < 1) return null;
  const externalKey =
    candidate.externalKey === null || typeof candidate.externalKey === "string"
      ? candidate.externalKey
      : null;
  const message =
    typeof candidate.message === "string" && candidate.message.trim().length > 0
      ? candidate.message
      : "Строку импортировать не удалось.";
  const code =
    typeof candidate.code === "string" &&
    DATA_IMPORT_ERROR_CODES.includes(candidate.code as DataImportErrorCode)
      ? (candidate.code as DataImportErrorCode)
      : "legacy_row_validation_failed";
  const input: DataImportRowIssueInput = {
    rowNumber,
    externalKey,
    code,
    message,
    ...(typeof candidate.column === "string" ? { column: candidate.column } : {}),
    ...(typeof candidate.propertyKey === "string"
      ? { propertyKey: candidate.propertyKey }
      : {}),
    ...(typeof candidate.rawValue === "string" ? { rawValue: candidate.rawValue } : {}),
    ...(candidate.severity === "warning" ? { severity: "warning" as const } : {})
  };
  const normalized = dataImportRowIssue(input);
  if (
    candidate.repair !== null &&
    typeof candidate.repair === "object" &&
    !Array.isArray(candidate.repair)
  ) {
    const repair = candidate.repair as Record<string, unknown>;
    if (
      repair.kind === "edit_cell" ||
      repair.kind === "choose_identity_column" ||
      repair.kind === "change_field_type" ||
      repair.kind === "review_row"
    ) {
      normalized.repair = {
        kind: repair.kind,
        ...(typeof repair.column === "string" ? { column: repair.column } : {}),
        ...(typeof repair.propertyKey === "string"
          ? { propertyKey: repair.propertyKey }
          : {}),
        ...(Array.isArray(repair.acceptedFormats) &&
        repair.acceptedFormats.every((item) => typeof item === "string")
          ? { acceptedFormats: repair.acceptedFormats as string[] }
          : {})
      };
    }
  }
  return normalized;
}
