import { createHash, randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { ContentAddressedObjectStore, type StoredObject } from "./object-store.js";
import { DomainEventOutbox } from "./outbox.js";

export type MultiFieldTestVersionFormat = "docx" | "xlsx";
export type MultiFieldValueType =
  | "string"
  | "text"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "date-time";

export interface RecordMultiFieldTestValueInput {
  fieldId: string;
  fieldKey: string;
  fieldLabel: string;
  valueType: MultiFieldValueType;
  required: boolean;
  binding: JsonValue;
  formatter?: JsonValue;
  technicalBinding: JsonValue;
  sampleValue: JsonValue;
  renderedValue: string;
  readBackValue: string;
  verification: JsonValue;
}

export interface RecordMultiFieldTestVersionInput {
  id?: string;
  spaceId: string;
  draftId: string;
  format: MultiFieldTestVersionFormat;
  compiledBuffer: Uint8Array;
  trialBuffer: Uint8Array;
  fields: readonly RecordMultiFieldTestValueInput[];
  repeatContract?: JsonValue;
  verification: JsonValue;
}

export interface MultiFieldTestValueRecord {
  fieldId: string;
  ordinal: number;
  fieldKey: string;
  fieldLabel: string;
  valueType: MultiFieldValueType;
  required: boolean;
  binding: JsonValue;
  formatter: JsonValue;
  technicalBinding: JsonValue;
  sampleValue: JsonValue;
  renderedValue: string;
  readBackValue: string;
  verification: JsonValue;
}

export interface MultiFieldTestVersionRecord {
  id: string;
  spaceId: string;
  draftId: string;
  versionNumber: number;
  format: MultiFieldTestVersionFormat;
  compiledFileId: string;
  trialFileId: string;
  compiledSha256: string;
  trialSha256: string;
  sampleValues: JsonValue;
  verification: JsonValue;
  fieldCount: number;
  repeatContract: JsonValue | null;
  fields: MultiFieldTestValueRecord[];
  status: "tested";
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
}

interface VersionRow {
  id: string;
  space_id: string;
  draft_id: string;
  version_number: number;
  format: string;
  compiled_file_id: string;
  trial_file_id: string;
  compiled_sha256: string;
  trial_sha256: string;
  sample_values_json: string;
  verification_json: string;
  field_count: number;
  repeat_contract_json: string | null;
  status: string;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
}

interface FieldRow {
  test_version_id: string;
  field_id: string;
  ordinal: number;
  field_key: string;
  field_label: string;
  value_type: string;
  required: number;
  binding_json: string;
  formatter_json: string;
  technical_binding_json: string;
  sample_value_json: string;
  rendered_value: string;
  read_back_value: string;
  verification_json: string;
}

interface DraftRow {
  id: string;
  space_id: string;
  title: string;
  format: string;
  status: string;
  repeat_binding_json: string | null;
}

interface DraftFieldRow {
  id: string;
  draft_id: string;
  field_key: string;
  label: string;
  value_type: string;
  required: number;
  binding_json: string;
  formatter_json: string;
}

interface FileRow {
  id: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
}

export class MultiFieldTestVersionValidationError extends Error {
  override readonly name = "MultiFieldTestVersionValidationError";
}

export class MultiFieldTestVersionNotFoundError extends Error {
  override readonly name = "MultiFieldTestVersionNotFoundError";
}

export class MultiFieldTestVersionConflictError extends Error {
  override readonly name = "MultiFieldTestVersionConflictError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new MultiFieldTestVersionValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new MultiFieldTestVersionValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new MultiFieldTestVersionValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function exactValue(value: string, name: string, maximum = 20_000): string {
  if (typeof value !== "string") {
    throw new MultiFieldTestVersionValidationError(`${name} must be a string`);
  }
  if (value.length > maximum) {
    throw new MultiFieldTestVersionValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  if (/\u0000/u.test(value)) {
    throw new MultiFieldTestVersionValidationError(
      `${name} contains an invalid control character`
    );
  }
  return value;
}

function formatValue(value: string): MultiFieldTestVersionFormat {
  if (value === "docx" || value === "xlsx") return value;
  throw new MultiFieldTestVersionValidationError(
    `Unsupported template format: ${value}`
  );
}

function valueType(value: string): MultiFieldValueType {
  if (
    value === "string" ||
    value === "text" ||
    value === "number" ||
    value === "integer" ||
    value === "boolean" ||
    value === "date" ||
    value === "date-time"
  ) {
    return value;
  }
  throw new MultiFieldTestVersionValidationError(
    `Unsupported field value type: ${value}`
  );
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new MultiFieldTestVersionValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function contextValue(context: MutationContext): {
  correlationId: string;
  actorType: string;
  actorId: string | null;
  now: string;
} {
  return {
    correlationId: requiredText(context.correlationId, "correlationId", 160),
    actorType: requiredText(context.actorType, "actorType", 80),
    actorId:
      context.actorId === undefined || context.actorId === null
        ? null
        : requiredText(context.actorId, "actorId", 160),
    now: timestamp(context.now)
  };
}

function safeBaseName(title: string): string {
  const normalized = title
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
  return normalized.length === 0 ? "Шаблон" : normalized;
}

function ensureFile(
  connection: SqliteExecutor,
  stored: StoredObject,
  originalName: string,
  mediaType: string,
  createdAt: string,
  createdBy: string | null
): FileRow {
  const existing = connection
    .prepare(
      "SELECT id, sha256, size_bytes, storage_path FROM files WHERE sha256 = ?"
    )
    .get(stored.sha256) as FileRow | undefined;
  if (existing !== undefined) {
    if (
      Number(existing.size_bytes) !== stored.sizeBytes ||
      existing.storage_path !== stored.relativePath
    ) {
      throw new MultiFieldTestVersionConflictError(
        "Stored file metadata conflicts with content-addressed object"
      );
    }
    return existing;
  }
  const id = randomUUID();
  connection
    .prepare(`
      INSERT INTO files(
        id, sha256, original_name, media_type, size_bytes,
        storage_path, created_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      stored.sha256,
      originalName,
      mediaType,
      stored.sizeBytes,
      stored.relativePath,
      createdAt,
      createdBy
    );
  return {
    id,
    sha256: stored.sha256,
    size_bytes: stored.sizeBytes,
    storage_path: stored.relativePath
  };
}

function mapField(row: FieldRow): MultiFieldTestValueRecord {
  return {
    fieldId: row.field_id,
    ordinal: Number(row.ordinal),
    fieldKey: row.field_key,
    fieldLabel: row.field_label,
    valueType: valueType(row.value_type),
    required: row.required === 1,
    binding: parseJson(row.binding_json),
    formatter: parseJson(row.formatter_json),
    technicalBinding: parseJson(row.technical_binding_json),
    sampleValue: parseJson(row.sample_value_json),
    renderedValue: row.rendered_value,
    readBackValue: row.read_back_value,
    verification: parseJson(row.verification_json)
  };
}

function fieldsForVersion(
  connection: SqliteExecutor,
  versionId: string
): MultiFieldTestValueRecord[] {
  const rows = connection
    .prepare(`
      SELECT *
      FROM template_multi_test_version_fields
      WHERE test_version_id = ?
      ORDER BY ordinal ASC, field_id ASC
    `)
    .all(versionId) as unknown as FieldRow[];
  return rows.map(mapField);
}

function mapVersion(
  connection: SqliteExecutor,
  row: VersionRow
): MultiFieldTestVersionRecord {
  if (row.status !== "tested") {
    throw new Error(`Stored multi-field test status is invalid: ${row.status}`);
  }
  const fields = fieldsForVersion(connection, row.id);
  if (fields.length !== Number(row.field_count)) {
    throw new Error(
      `Multi-field test version ${row.id} expected ${row.field_count} fields, found ${fields.length}`
    );
  }
  return {
    id: row.id,
    spaceId: row.space_id,
    draftId: row.draft_id,
    versionNumber: Number(row.version_number),
    format: formatValue(row.format),
    compiledFileId: row.compiled_file_id,
    trialFileId: row.trial_file_id,
    compiledSha256: row.compiled_sha256,
    trialSha256: row.trial_sha256,
    sampleValues: parseJson(row.sample_values_json),
    verification: parseJson(row.verification_json),
    fieldCount: Number(row.field_count),
    repeatContract:
      row.repeat_contract_json === null
        ? null
        : parseJson(row.repeat_contract_json),
    fields,
    status: "tested",
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at
  };
}

function jsonObject(
  value: JsonValue | undefined
): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function docxRepeatIdentifier(binding: { [key: string]: JsonValue }): string {
  return `airepeat:${createHash("sha256")
    .update(String(binding.part))
    .update("\u0000")
    .update(String(binding.tableIndex))
    .update("\u0000")
    .update(String(binding.rowIndex))
    .update("\u0000")
    .update("audience.members")
    .digest("hex")
    .slice(0, 24)}`;
}

function xlsxRepeatIdentifier(binding: { [key: string]: JsonValue }): string {
  return `_DOCOMATOR_REPEAT_${createHash("sha256")
    .update(String(binding.sheetPath))
    .update("\u0000")
    .update(String(binding.rowNumber))
    .update("\u0000")
    .update(String(binding.startAddress))
    .update("\u0000")
    .update(String(binding.endAddress))
    .update("\u0000")
    .update("audience.members")
    .digest("hex")
    .slice(0, 24)
    .toUpperCase()}`;
}

function exactJsonKeys(
  value: { [key: string]: JsonValue },
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function xlsxCellCoordinate(value: JsonValue | undefined): {
  address: string;
  column: number;
  row: number;
} | null {
  if (typeof value !== "string") return null;
  const address = value.toUpperCase();
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(address);
  if (match === null) return null;
  let column = 0;
  for (const character of match[1] ?? "") {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  const row = Number(match[2]);
  return column >= 1 && column <= 16_384 && row >= 1 && row <= 1_048_576
    ? { address, column, row }
    : null;
}

function xlsxRepeatTarget(binding: { [key: string]: JsonValue }): string | null {
  const start = xlsxCellCoordinate(binding.startAddress);
  const end = xlsxCellCoordinate(binding.endAddress);
  if (start === null || end === null || typeof binding.sheetName !== "string") {
    return null;
  }
  const sheetName = `'${binding.sheetName.replaceAll("'", "''")}'`;
  const absolute = (address: string): string => {
    const match = /^([A-Z]+)([0-9]+)$/u.exec(address);
    return match === null ? address : `$${match[1]}$${match[2]}`;
  };
  return `${sheetName}!${absolute(start.address)}:${absolute(end.address)}`;
}

function repeatBindingFromContract(
  contract: JsonValue,
  format: MultiFieldTestVersionFormat
): JsonValue {
  if (!jsonObject(contract) || !jsonObject(contract.binding) || !jsonObject(contract.technicalBinding)) {
    throw new MultiFieldTestVersionValidationError(
      "repeatContract must contain a supported repeat row contract"
    );
  }
  const binding = contract.binding;
  const technical = contract.technicalBinding;
  if (
    format === "docx" &&
    exactJsonKeys(contract, ["version", "kind", "binding", "technicalBinding"]) &&
    exactJsonKeys(binding, [
      "version",
      "kind",
      "source",
      "anchorElementId",
      "part",
      "tableIndex",
      "rowIndex"
    ]) &&
    exactJsonKeys(technical, ["kind", "identifier", "part", "target"]) &&
    contract.version === 1 &&
    contract.kind === "docx.repeat-row-contract" &&
    binding.version === 1 &&
    binding.kind === "docx.repeat-row" &&
    binding.source === "audience.members" &&
    typeof binding.anchorElementId === "string" &&
    binding.anchorElementId.length > 0 &&
    typeof binding.part === "string" &&
    binding.part.length > 0 &&
    typeof binding.tableIndex === "number" &&
    Number.isInteger(binding.tableIndex) &&
    binding.tableIndex >= 0 &&
    typeof binding.rowIndex === "number" &&
    Number.isInteger(binding.rowIndex) &&
    binding.rowIndex >= 0 &&
    technical.kind === "docx.repeat-sdt" &&
    technical.identifier === docxRepeatIdentifier(binding) &&
    technical.part === binding.part &&
    typeof technical.target === "string" &&
    technical.target.length > 0
  ) {
    return toJsonValue(binding);
  }
  if (format === "docx") {
    throw new MultiFieldTestVersionValidationError(
      "repeatContract must contain a supported DOCX repeat row contract"
    );
  }
  const start = xlsxCellCoordinate(binding.startAddress);
  const end = xlsxCellCoordinate(binding.endAddress);
  const target = xlsxRepeatTarget(binding);
  if (
    format !== "xlsx" ||
    !exactJsonKeys(contract, ["version", "kind", "binding", "technicalBinding"]) ||
    !exactJsonKeys(binding, [
      "version",
      "kind",
      "source",
      "selection",
      "sheetName",
      "sheetPath",
      "rowNumber",
      "startAddress",
      "endAddress",
      "startElementId",
      "endElementId"
    ]) ||
    !exactJsonKeys(technical, ["kind", "identifier", "part", "target"]) ||
    contract.version !== 1 ||
    contract.kind !== "xlsx.repeat-row-contract" ||
    binding.version !== 1 ||
    binding.kind !== "xlsx.repeat-row" ||
    binding.source !== "audience.members" ||
    (binding.selection !== "used-row" && binding.selection !== "range") ||
    typeof binding.sheetName !== "string" ||
    binding.sheetName.length === 0 ||
    binding.sheetName.length > 255 ||
    typeof binding.sheetPath !== "string" ||
    binding.sheetPath.length === 0 ||
    binding.sheetPath.length > 500 ||
    typeof binding.rowNumber !== "number" ||
    !Number.isInteger(binding.rowNumber) ||
    start === null ||
    end === null ||
    start.row !== binding.rowNumber ||
    end.row !== binding.rowNumber ||
    start.column > end.column ||
    typeof binding.startElementId !== "string" ||
    binding.startElementId.length === 0 ||
    typeof binding.endElementId !== "string" ||
    binding.endElementId.length === 0 ||
    technical.kind !== "xlsx.repeat-defined-name" ||
    technical.identifier !== xlsxRepeatIdentifier(binding) ||
    technical.part !== "xl/workbook.xml" ||
    target === null ||
    technical.target !== target
  ) {
    throw new MultiFieldTestVersionValidationError(
      "repeatContract must contain a supported XLSX repeat row contract"
    );
  }
  return toJsonValue(binding);
}

function versionRow(
  connection: SqliteExecutor,
  spaceId: string,
  versionId: string
): VersionRow | undefined {
  return connection
    .prepare(
      "SELECT * FROM template_multi_test_versions WHERE id = ? AND space_id = ?"
    )
    .get(versionId, spaceId) as VersionRow | undefined;
}

function normalizeFields(
  fields: readonly RecordMultiFieldTestValueInput[]
): RecordMultiFieldTestValueInput[] {
  if (!Number.isInteger(fields.length) || fields.length < 1 || fields.length > 100) {
    throw new MultiFieldTestVersionValidationError(
      "fields must contain between 1 and 100 values"
    );
  }
  const normalized = fields.map((field) => {
    const renderedValue = exactValue(field.renderedValue, "renderedValue");
    const readBackValue = exactValue(field.readBackValue, "readBackValue");
    if (renderedValue !== readBackValue) {
      throw new MultiFieldTestVersionValidationError(
        `Rendered value must match the read-back value for field ${field.fieldKey}`
      );
    }
    return {
      fieldId: requiredText(field.fieldId, "fieldId", 160),
      fieldKey: requiredText(field.fieldKey, "fieldKey", 160),
      fieldLabel: requiredText(field.fieldLabel, "fieldLabel", 500),
      valueType: valueType(field.valueType),
      required: Boolean(field.required),
      binding: toJsonValue(field.binding),
      formatter: toJsonValue(
        field.formatter ?? { version: 1, kind: "legacy" }
      ),
      technicalBinding: toJsonValue(field.technicalBinding),
      sampleValue: toJsonValue(field.sampleValue),
      renderedValue,
      readBackValue,
      verification: toJsonValue(field.verification)
    };
  });
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const field of normalized) {
    if (ids.has(field.fieldId)) {
      throw new MultiFieldTestVersionValidationError(
        `Duplicate fieldId in multi-field version: ${field.fieldId}`
      );
    }
    if (keys.has(field.fieldKey)) {
      throw new MultiFieldTestVersionValidationError(
        `Duplicate fieldKey in multi-field version: ${field.fieldKey}`
      );
    }
    ids.add(field.fieldId);
    keys.add(field.fieldKey);
  }
  return normalized.sort(
    (left, right) =>
      left.fieldKey.localeCompare(right.fieldKey, "en") ||
      left.fieldId.localeCompare(right.fieldId, "en")
  );
}

export class MultiFieldTestVersionRegistry {
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;

  constructor(
    private readonly store: SqliteStore,
    private readonly objectStore: ContentAddressedObjectStore,
    options: { outbox?: DomainEventOutbox; audit?: AuditRepository } = {}
  ) {
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
  }

  async recordTestedVersion(
    input: RecordMultiFieldTestVersionInput,
    contextInput: MutationContext
  ): Promise<MultiFieldTestVersionRecord> {
    const id = input.id ?? randomUUID();
    const spaceId = requiredText(input.spaceId, "spaceId", 160);
    const draftId = requiredText(input.draftId, "draftId", 160);
    const format = formatValue(input.format);
    const fields = normalizeFields(input.fields);
    const verification = toJsonValue(input.verification);
    const repeatContract =
      input.repeatContract === undefined
        ? null
        : toJsonValue(input.repeatContract);
    const sampleValues = toJsonValue(
      Object.fromEntries(fields.map((field) => [field.fieldKey, field.sampleValue]))
    );
    const sampleValuesJson = stringifyJson(sampleValues);
    const compiledBuffer = Buffer.from(input.compiledBuffer);
    const trialBuffer = Buffer.from(input.trialBuffer);
    if (compiledBuffer.length === 0 || trialBuffer.length === 0) {
      throw new MultiFieldTestVersionValidationError(
        "Compiled and trial documents must not be empty"
      );
    }
    const context = contextValue(contextInput);
    const compiledStored = await this.objectStore.putBuffer(compiledBuffer);
    const trialStored = await this.objectStore.putBuffer(trialBuffer);

    return this.store.transaction((connection) => {
      const draft = connection
        .prepare(
          "SELECT id, space_id, title, format, status, repeat_binding_json FROM template_drafts WHERE id = ? AND space_id = ?"
        )
        .get(draftId, spaceId) as DraftRow | undefined;
      if (draft === undefined || draft.status !== "draft") {
        throw new MultiFieldTestVersionNotFoundError(
          `Template draft was not found in this space: ${draftId}`
        );
      }
      if (draft.format !== format) {
        throw new MultiFieldTestVersionValidationError(
          "Multi-field test format does not match the template draft"
        );
      }
      if (
        (draft.repeat_binding_json === null) !== (repeatContract === null) ||
        (draft.repeat_binding_json !== null &&
          repeatContract !== null &&
          stringifyJson(parseJson(draft.repeat_binding_json)) !==
            stringifyJson(repeatBindingFromContract(repeatContract, format)))
      ) {
        throw new MultiFieldTestVersionValidationError(
          "Repeat row contract does not match the template draft"
        );
      }

      const placeholders = fields.map(() => "?").join(", ");
      const draftFields = connection
        .prepare(`
          SELECT id, draft_id, field_key, label, value_type, required,
                 binding_json, formatter_json
          FROM template_draft_fields
          WHERE draft_id = ? AND id IN (${placeholders})
        `)
        .all(draftId, ...fields.map((field) => field.fieldId)) as unknown as DraftFieldRow[];
      if (draftFields.length !== fields.length) {
        throw new MultiFieldTestVersionNotFoundError(
          "One or more template fields were not found in this draft"
        );
      }
      const storedById = new Map(draftFields.map((field) => [field.id, field]));
      for (const field of fields) {
        const stored = storedById.get(field.fieldId);
        if (
          stored === undefined ||
          stored.field_key !== field.fieldKey ||
          stored.label !== field.fieldLabel ||
          stored.value_type !== field.valueType ||
          (stored.required === 1) !== field.required ||
          stringifyJson(parseJson(stored.binding_json)) !== stringifyJson(field.binding) ||
          stringifyJson(parseJson(stored.formatter_json)) !== stringifyJson(field.formatter)
        ) {
          throw new MultiFieldTestVersionValidationError(
            `Stored template field changed before multi-field testing: ${field.fieldKey}`
          );
        }
      }

      const existing = connection
        .prepare(`
          SELECT *
          FROM template_multi_test_versions
          WHERE draft_id = ?
            AND compiled_sha256 = ?
            AND trial_sha256 = ?
            AND sample_values_json = ?
        `)
        .get(
          draftId,
          compiledStored.sha256,
          trialStored.sha256,
          sampleValuesJson
        ) as VersionRow | undefined;
      if (existing !== undefined) return mapVersion(connection, existing);

      const mediaType =
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const baseName = safeBaseName(draft.title);
      const compiledFile = ensureFile(
        connection,
        compiledStored,
        `${baseName}-многополевая-привязка.${format}`,
        mediaType,
        context.now,
        context.actorId
      );
      const trialFile = ensureFile(
        connection,
        trialStored,
        `${baseName}-многополевая-проверка.${format}`,
        mediaType,
        context.now,
        context.actorId
      );
      const current = connection
        .prepare(`
          SELECT COALESCE(MAX(version_number), 0) AS value
          FROM (
            SELECT version_number FROM template_test_versions WHERE draft_id = ?
            UNION ALL
            SELECT version_number FROM template_multi_test_versions WHERE draft_id = ?
          )
        `)
        .get(draftId, draftId) as { value: number };
      const versionNumber = Number(current.value) + 1;

      connection
        .prepare(`
          INSERT INTO template_multi_test_versions(
            id, space_id, draft_id, version_number, format,
            compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
            sample_values_json, verification_json, field_count, status,
            repeat_contract_json, created_by, correlation_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tested', ?, ?, ?, ?)
        `)
        .run(
          id,
          spaceId,
          draftId,
          versionNumber,
          format,
          compiledFile.id,
          trialFile.id,
          compiledStored.sha256,
          trialStored.sha256,
          sampleValuesJson,
          stringifyJson(verification),
          fields.length,
          repeatContract === null ? null : stringifyJson(repeatContract),
          context.actorId,
          context.correlationId,
          context.now
        );
      const insertField = connection.prepare(`
        INSERT INTO template_multi_test_version_fields(
          test_version_id, field_id, ordinal, field_key, field_label,
          value_type, required, binding_json, formatter_json, technical_binding_json,
          sample_value_json, rendered_value, read_back_value, verification_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [ordinal, field] of fields.entries()) {
        insertField.run(
          id,
          field.fieldId,
          ordinal,
          field.fieldKey,
          field.fieldLabel,
          field.valueType,
          field.required ? 1 : 0,
          stringifyJson(field.binding),
          stringifyJson(field.formatter),
          stringifyJson(field.technicalBinding),
          stringifyJson(field.sampleValue),
          field.renderedValue,
          field.readBackValue,
          stringifyJson(field.verification)
        );
      }

      this.outbox.append(
        {
          eventType: "template.multi-test-version.created",
          schemaVersion: 1,
          source: "multi-field-test-version-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId,
            draftId,
            versionNumber,
            format,
            fieldCount: fields.length,
            fieldIds: fields.map((field) => field.fieldId),
            compiledSha256: compiledStored.sha256,
            trialSha256: trialStored.sha256
          },
          dedupeKey: `template.multi-test-version.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "multi_field_trial_render",
          objectType: "template_draft",
          objectId: draftId,
          correlationId: context.correlationId,
          details: {
            testVersionId: id,
            versionNumber,
            fieldCount: fields.length,
            fieldKeys: fields.map((field) => field.fieldKey),
            compiledSha256: compiledStored.sha256,
            trialSha256: trialStored.sha256
          }
        },
        connection
      );

      const row = versionRow(connection, spaceId, id);
      if (row === undefined) {
        throw new Error(`Created multi-field test version was not found: ${id}`);
      }
      return mapVersion(connection, row);
    });
  }

  listVersions(
    spaceIdentity: string,
    draftIdValue: string,
    limitValue = 100
  ): MultiFieldTestVersionRecord[] {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const draftId = requiredText(draftIdValue, "draftId", 160);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 500) {
      throw new MultiFieldTestVersionValidationError(
        "limit must be an integer in range 1..500"
      );
    }
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new MultiFieldTestVersionNotFoundError(`Space was not found: ${identity}`);
      }
      const draft = connection
        .prepare("SELECT id FROM template_drafts WHERE id = ? AND space_id = ?")
        .get(draftId, space.id) as { id: string } | undefined;
      if (draft === undefined) {
        throw new MultiFieldTestVersionNotFoundError(
          `Template draft was not found in this space: ${draftId}`
        );
      }
      const rows = connection
        .prepare(`
          SELECT *
          FROM template_multi_test_versions
          WHERE draft_id = ? AND space_id = ?
          ORDER BY version_number DESC, id DESC
          LIMIT ?
        `)
        .all(draftId, space.id, limitValue) as unknown as VersionRow[];
      return rows.map((row) => mapVersion(connection, row));
    });
  }

  getVersion(
    spaceIdentity: string,
    versionIdValue: string
  ): MultiFieldTestVersionRecord {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const versionId = requiredText(versionIdValue, "versionId", 160);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new MultiFieldTestVersionNotFoundError(`Space was not found: ${identity}`);
      }
      const row = versionRow(connection, space.id, versionId);
      if (row === undefined) {
        throw new MultiFieldTestVersionNotFoundError(
          `Multi-field test version was not found in this space: ${versionId}`
        );
      }
      return mapVersion(connection, row);
    });
  }
}
