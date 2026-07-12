import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";

export type TemplateDraftFormat = "docx" | "xlsx";
export type TemplateDraftStatus = "draft" | "archived";
export type TemplateFieldValueType =
  | "string"
  | "text"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "date-time";
export type TemplateFieldElementKind = "paragraph" | "cell";

export interface CreateTemplateDraftInput {
  id?: string;
  spaceId: string;
  sourceRecordId: string;
  title: string;
  format: TemplateDraftFormat;
  sourceSha256: string;
  structureVersion?: number;
  structureSha256: string;
  structure: JsonValue;
  structureTruncated: boolean;
}

export interface CreateTemplateDraftFieldInput {
  id?: string;
  key: string;
  label: string;
  valueType: TemplateFieldValueType;
  required?: boolean;
  elementId: string;
  elementKind: TemplateFieldElementKind;
  binding: JsonValue;
  originalPreview: string;
  structureSha256: string;
}

export interface TemplateDraftFieldRecord {
  id: string;
  draftId: string;
  key: string;
  label: string;
  valueType: TemplateFieldValueType;
  required: boolean;
  elementId: string;
  elementKind: TemplateFieldElementKind;
  binding: JsonValue;
  originalPreview: string;
  structureSha256: string;
  version: number;
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDraftRecord {
  id: string;
  spaceId: string;
  sourceRecordId: string;
  title: string;
  format: TemplateDraftFormat;
  sourceSha256: string;
  structureVersion: number;
  structureSha256: string;
  structure: JsonValue;
  structureTruncated: boolean;
  status: TemplateDraftStatus;
  version: number;
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  fields: TemplateDraftFieldRecord[];
}

interface DraftRow {
  id: string;
  space_id: string;
  source_record_id: string;
  title: string;
  format: string;
  source_sha256: string;
  structure_version: number;
  structure_sha256: string;
  structure_json: string;
  structure_truncated: number;
  status: string;
  version: number;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

interface FieldRow {
  id: string;
  draft_id: string;
  field_key: string;
  label: string;
  value_type: string;
  required: number;
  element_id: string;
  element_kind: string;
  binding_json: string;
  original_preview: string;
  structure_sha256: string;
  version: number;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

export class TemplateDraftValidationError extends Error {
  override readonly name = "TemplateDraftValidationError";
}

export class TemplateDraftNotFoundError extends Error {
  override readonly name = "TemplateDraftNotFoundError";
}

export class TemplateDraftConflictError extends Error {
  override readonly name = "TemplateDraftConflictError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new TemplateDraftValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TemplateDraftValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new TemplateDraftValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function sha256(value: string, name: string): string {
  const normalized = requiredText(value, name, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new TemplateDraftValidationError(
      `${name} must contain 64 hexadecimal characters`
    );
  }
  return normalized;
}

function fieldKey(value: string): string {
  const normalized = requiredText(value, "key", 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new TemplateDraftValidationError(
      "key must start with a Latin letter and contain lowercase Latin letters, digits, dots, underscores or hyphens"
    );
  }
  return normalized;
}

function draftFormat(value: string): TemplateDraftFormat {
  if (value === "docx" || value === "xlsx") return value;
  throw new TemplateDraftValidationError(`Unsupported template draft format: ${value}`);
}

function draftStatus(value: string): TemplateDraftStatus {
  if (value === "draft" || value === "archived") return value;
  throw new Error(`Stored template draft status is invalid: ${value}`);
}

function fieldValueType(value: string): TemplateFieldValueType {
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
  throw new TemplateDraftValidationError(`Unsupported template field value type: ${value}`);
}

function elementKind(value: string): TemplateFieldElementKind {
  if (value === "paragraph" || value === "cell") return value;
  throw new TemplateDraftValidationError(`Unsupported template field element kind: ${value}`);
}

function timestamp(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TemplateDraftValidationError("Invalid mutation timestamp");
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

function mapField(row: FieldRow): TemplateDraftFieldRecord {
  return {
    id: row.id,
    draftId: row.draft_id,
    key: row.field_key,
    label: row.label,
    valueType: fieldValueType(row.value_type),
    required: row.required === 1,
    elementId: row.element_id,
    elementKind: elementKind(row.element_kind),
    binding: parseJson(row.binding_json),
    originalPreview: row.original_preview,
    structureSha256: row.structure_sha256,
    version: row.version,
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function fieldsForDraft(
  connection: SqliteExecutor,
  draftId: string
): TemplateDraftFieldRecord[] {
  const rows = connection
    .prepare(`
      SELECT *
      FROM template_draft_fields
      WHERE draft_id = ?
      ORDER BY created_at ASC, id ASC
    `)
    .all(draftId) as unknown as FieldRow[];
  return rows.map(mapField);
}

function mapDraft(
  connection: SqliteExecutor,
  row: DraftRow
): TemplateDraftRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    sourceRecordId: row.source_record_id,
    title: row.title,
    format: draftFormat(row.format),
    sourceSha256: row.source_sha256,
    structureVersion: row.structure_version,
    structureSha256: row.structure_sha256,
    structure: parseJson(row.structure_json),
    structureTruncated: row.structure_truncated === 1,
    status: draftStatus(row.status),
    version: row.version,
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fields: fieldsForDraft(connection, row.id)
  };
}

function draftRow(
  connection: SqliteExecutor,
  spaceId: string,
  draftId: string
): DraftRow | undefined {
  return connection
    .prepare("SELECT * FROM template_drafts WHERE id = ? AND space_id = ?")
    .get(draftId, spaceId) as DraftRow | undefined;
}

export class TemplateDraftRegistry {
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;

  constructor(
    private readonly store: SqliteStore,
    options: { outbox?: DomainEventOutbox; audit?: AuditRepository } = {}
  ) {
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
  }

  createOrGetDraft(
    input: CreateTemplateDraftInput,
    contextInput: MutationContext
  ): TemplateDraftRecord {
    const id = input.id ?? randomUUID();
    const spaceId = requiredText(input.spaceId, "spaceId", 160);
    const sourceRecordId = requiredText(input.sourceRecordId, "sourceRecordId", 160);
    const title = requiredText(input.title, "title", 500);
    const format = draftFormat(input.format);
    const sourceSha256 = sha256(input.sourceSha256, "sourceSha256");
    const structureSha256 = sha256(input.structureSha256, "structureSha256");
    const structureVersion = input.structureVersion ?? 1;
    if (!Number.isInteger(structureVersion) || structureVersion < 1) {
      throw new TemplateDraftValidationError("structureVersion must be a positive integer");
    }
    const structure = toJsonValue(input.structure);
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const source = connection
        .prepare(`
          SELECT q.id, q.space_id, q.format, f.sha256
          FROM document_quarantine_records q
          JOIN files f ON f.id = q.file_id
          WHERE q.id = ? AND q.space_id = ?
        `)
        .get(sourceRecordId, spaceId) as
        | { id: string; space_id: string; format: string; sha256: string }
        | undefined;
      if (source === undefined) {
        throw new TemplateDraftNotFoundError(
          `Quarantine document was not found in this space: ${sourceRecordId}`
        );
      }
      if (source.sha256 !== sourceSha256 || source.format !== format) {
        throw new TemplateDraftValidationError(
          "Template draft source no longer matches the verified document"
        );
      }

      const existing = connection
        .prepare(
          "SELECT * FROM template_drafts WHERE space_id = ? AND source_record_id = ?"
        )
        .get(spaceId, sourceRecordId) as DraftRow | undefined;
      if (existing !== undefined) {
        if (
          existing.source_sha256 !== sourceSha256 ||
          existing.structure_sha256 !== structureSha256 ||
          existing.structure_version !== structureVersion
        ) {
          throw new TemplateDraftConflictError(
            "A draft already exists for another structure version of this source"
          );
        }
        return mapDraft(connection, existing);
      }

      connection
        .prepare(`
          INSERT INTO template_drafts(
            id, space_id, source_record_id, title, format, source_sha256,
            structure_version, structure_sha256, structure_json,
            structure_truncated, status, version, created_by,
            correlation_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)
        `)
        .run(
          id,
          spaceId,
          sourceRecordId,
          title,
          format,
          sourceSha256,
          structureVersion,
          structureSha256,
          stringifyJson(structure),
          input.structureTruncated ? 1 : 0,
          context.actorId,
          context.correlationId,
          context.now,
          context.now
        );

      this.outbox.append(
        {
          eventType: "template.draft.created",
          schemaVersion: 1,
          source: "template-draft-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId,
            sourceRecordId,
            sourceSha256,
            structureSha256,
            structureVersion
          },
          dedupeKey: `template.draft.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create",
          objectType: "template_draft",
          objectId: id,
          correlationId: context.correlationId,
          details: { spaceId, sourceRecordId, sourceSha256, structureSha256 }
        },
        connection
      );

      const created = draftRow(connection, spaceId, id);
      if (created === undefined) {
        throw new Error(`Created template draft was not found: ${id}`);
      }
      return mapDraft(connection, created);
    });
  }

  getDraft(spaceIdentity: string, draftIdValue: string): TemplateDraftRecord {
    const spaceIdentityValue = requiredText(spaceIdentity, "spaceId", 160);
    const draftId = requiredText(draftIdValue, "draftId", 160);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(spaceIdentityValue, spaceIdentityValue.toLowerCase()) as
        | { id: string }
        | undefined;
      if (space === undefined) {
        throw new TemplateDraftNotFoundError(`Space was not found: ${spaceIdentityValue}`);
      }
      const row = draftRow(connection, space.id, draftId);
      if (row === undefined) {
        throw new TemplateDraftNotFoundError(
          `Template draft was not found in this space: ${draftId}`
        );
      }
      return mapDraft(connection, row);
    });
  }

  listDrafts(spaceIdentity: string, limitValue = 100): TemplateDraftRecord[] {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 500) {
      throw new TemplateDraftValidationError("limit must be an integer in range 1..500");
    }
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new TemplateDraftNotFoundError(`Space was not found: ${identity}`);
      }
      const rows = connection
        .prepare(`
          SELECT * FROM template_drafts
          WHERE space_id = ?
          ORDER BY updated_at DESC, id DESC
          LIMIT ?
        `)
        .all(space.id, limitValue) as unknown as DraftRow[];
      return rows.map((row) => mapDraft(connection, row));
    });
  }

  createField(
    spaceIdentity: string,
    draftIdValue: string,
    input: CreateTemplateDraftFieldInput,
    contextInput: MutationContext
  ): TemplateDraftFieldRecord {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const draftId = requiredText(draftIdValue, "draftId", 160);
    const id = input.id ?? randomUUID();
    const key = fieldKey(input.key);
    const label = requiredText(input.label, "label", 500);
    const valueType = fieldValueType(input.valueType);
    const elementId = requiredText(input.elementId, "elementId", 160);
    const kind = elementKind(input.elementKind);
    const binding = toJsonValue(input.binding);
    const originalPreview = input.originalPreview.trim().slice(0, 4_000);
    const structureSha256 = sha256(input.structureSha256, "structureSha256");
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new TemplateDraftNotFoundError(`Space was not found: ${identity}`);
      }
      const draft = draftRow(connection, space.id, draftId);
      if (draft === undefined || draft.status !== "draft") {
        throw new TemplateDraftNotFoundError(
          `Template draft was not found in this space: ${draftId}`
        );
      }
      if (draft.structure_sha256 !== structureSha256) {
        throw new TemplateDraftValidationError(
          "Template field does not match the current draft structure"
        );
      }
      const duplicate = connection
        .prepare(`
          SELECT field_key, element_id
          FROM template_draft_fields
          WHERE draft_id = ? AND (field_key = ? OR element_id = ?)
        `)
        .get(draftId, key, elementId) as
        | { field_key: string; element_id: string }
        | undefined;
      if (duplicate !== undefined) {
        if (duplicate.field_key === key) {
          throw new TemplateDraftConflictError(`Template field already exists: ${key}`);
        }
        throw new TemplateDraftConflictError(
          `Template element already has a scalar field: ${elementId}`
        );
      }

      connection
        .prepare(`
          INSERT INTO template_draft_fields(
            id, draft_id, field_key, label, value_type, required,
            element_id, element_kind, binding_json, original_preview,
            structure_sha256, version, created_by, correlation_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `)
        .run(
          id,
          draftId,
          key,
          label,
          valueType,
          input.required ? 1 : 0,
          elementId,
          kind,
          stringifyJson(binding),
          originalPreview,
          structureSha256,
          context.actorId,
          context.correlationId,
          context.now,
          context.now
        );

      this.outbox.append(
        {
          eventType: "template.draft.field.created",
          schemaVersion: 1,
          source: "template-draft-registry",
          occurredAt: context.now,
          payload: { id, draftId, spaceId: space.id, key, elementId, valueType },
          dedupeKey: `template.draft.field.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "create_field",
          objectType: "template_draft",
          objectId: draftId,
          correlationId: context.correlationId,
          details: { fieldId: id, key, elementId, valueType }
        },
        connection
      );

      const row = connection
        .prepare("SELECT * FROM template_draft_fields WHERE id = ?")
        .get(id) as FieldRow | undefined;
      if (row === undefined) {
        throw new Error(`Created template field was not found: ${id}`);
      }
      return mapField(row);
    });
  }
}
