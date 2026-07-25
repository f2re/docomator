import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";
import {
  TemplateDraftConflictError,
  type TemplateDraftFieldRecord,
  TemplateDraftNotFoundError,
  TemplateDraftValidationError,
  type TemplateFieldValueType
} from "./template-drafts.js";

export interface UpdateTemplateDraftFieldInput {
  key: string;
  label: string;
  valueType: TemplateFieldValueType;
  required: boolean;
  formatter: JsonValue;
}

export interface DeleteTemplateDraftFieldResult {
  fieldId: string;
  remainingFieldCount: number;
  repeatBindingCleared: boolean;
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
  formatter_json: string;
  original_preview: string;
  structure_sha256: string;
  version: number;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

function requiredText(value: string, name: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new TemplateDraftValidationError(`${name} must be a string`);
  }
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    throw new TemplateDraftValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TemplateDraftValidationError(`${name} must not exceed ${maximum} characters`);
  }
  return normalized;
}

function stableFieldKey(value: string): string {
  const normalized = requiredText(value, "key", 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new TemplateDraftValidationError(
      "key must start with a Latin letter and contain lowercase Latin letters, digits, dots, underscores or hyphens"
    );
  }
  return normalized;
}

function fieldValueType(value: string): TemplateFieldValueType {
  if (
    value === "string" ||
    value === "text" ||
    value === "enum" ||
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
    elementKind:
      row.element_kind === "paragraph" || row.element_kind === "cell"
        ? row.element_kind
        : (() => {
            throw new TemplateDraftValidationError(
              `Unsupported template field element kind: ${row.element_kind}`
            );
          })(),
    binding: parseJson(row.binding_json),
    formatter: parseJson(row.formatter_json),
    originalPreview: row.original_preview,
    structureSha256: row.structure_sha256,
    version: row.version,
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function requireSpaceId(connection: SqliteExecutor, identityValue: string): string {
  const identity = requiredText(identityValue, "spaceId", 160);
  const row = connection
    .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
    .get(identity, identity.toLowerCase()) as { id: string } | undefined;
  if (row === undefined) {
    throw new TemplateDraftNotFoundError(`Space was not found: ${identity}`);
  }
  return row.id;
}

function requireDraft(
  connection: SqliteExecutor,
  spaceId: string,
  draftIdValue: string
): { id: string; repeat_binding_json: string | null; version: number } {
  const draftId = requiredText(draftIdValue, "draftId", 160);
  const row = connection
    .prepare(
      "SELECT id, repeat_binding_json, version FROM template_drafts WHERE id = ? AND space_id = ? AND status = 'draft'"
    )
    .get(draftId, spaceId) as
    | { id: string; repeat_binding_json: string | null; version: number }
    | undefined;
  if (row === undefined) {
    throw new TemplateDraftNotFoundError(
      `Template draft was not found in this space: ${draftId}`
    );
  }
  return row;
}

function requireField(
  connection: SqliteExecutor,
  draftId: string,
  fieldIdValue: string
): FieldRow {
  const fieldId = requiredText(fieldIdValue, "fieldId", 160);
  const row = connection
    .prepare("SELECT * FROM template_draft_fields WHERE id = ? AND draft_id = ?")
    .get(fieldId, draftId) as FieldRow | undefined;
  if (row === undefined) {
    throw new TemplateDraftNotFoundError(
      `Template draft field was not found in this space: ${fieldId}`
    );
  }
  return row;
}

export class TemplateDraftFieldEditor {
  private readonly audit: AuditRepository;
  private readonly outbox: DomainEventOutbox;

  constructor(
    private readonly store: SqliteStore,
    options: { audit?: AuditRepository; outbox?: DomainEventOutbox } = {}
  ) {
    this.audit = options.audit ?? new AuditRepository(store);
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
  }

  update(
    spaceIdentity: string,
    draftIdValue: string,
    fieldIdValue: string,
    input: UpdateTemplateDraftFieldInput,
    contextInput: MutationContext
  ): TemplateDraftFieldRecord {
    const key = stableFieldKey(input.key);
    const label = requiredText(input.label, "label", 500);
    const valueType = fieldValueType(input.valueType);
    const formatter = toJsonValue(input.formatter);
    const formatterJson = stringifyJson(formatter);
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const spaceId = requireSpaceId(connection, spaceIdentity);
      const draft = requireDraft(connection, spaceId, draftIdValue);
      const current = requireField(connection, draft.id, fieldIdValue);
      const duplicate = connection
        .prepare(
          "SELECT id FROM template_draft_fields WHERE draft_id = ? AND field_key = ? AND id <> ?"
        )
        .get(draft.id, key, current.id);
      if (duplicate !== undefined) {
        throw new TemplateDraftConflictError(`Template field already exists: ${key}`);
      }

      const unchanged =
        current.field_key === key &&
        current.label === label &&
        current.value_type === valueType &&
        current.required === (input.required ? 1 : 0) &&
        stringifyJson(parseJson(current.formatter_json)) === formatterJson;
      if (unchanged) return mapField(current);

      const fieldVersion = current.version + 1;
      const draftVersion = draft.version + 1;
      connection
        .prepare(`
          UPDATE template_draft_fields
          SET field_key = ?, label = ?, value_type = ?, required = ?,
              formatter_json = ?, version = ?, correlation_id = ?, updated_at = ?
          WHERE id = ? AND draft_id = ?
        `)
        .run(
          key,
          label,
          valueType,
          input.required ? 1 : 0,
          formatterJson,
          fieldVersion,
          context.correlationId,
          context.now,
          current.id,
          draft.id
        );
      connection
        .prepare("UPDATE template_drafts SET version = ?, updated_at = ? WHERE id = ?")
        .run(draftVersion, context.now, draft.id);

      this.outbox.append(
        {
          eventType: "template.draft.field.updated",
          schemaVersion: 1,
          source: "template-draft-field-editor",
          occurredAt: context.now,
          payload: {
            id: current.id,
            draftId: draft.id,
            spaceId,
            key,
            valueType,
            fieldVersion,
            draftVersion
          },
          dedupeKey: `template.draft.field.updated:${current.id}:v${fieldVersion}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "update_field",
          objectType: "template_draft",
          objectId: draft.id,
          correlationId: context.correlationId,
          details: {
            fieldId: current.id,
            previousKey: current.field_key,
            key,
            valueType,
            fieldVersion,
            draftVersion
          }
        },
        connection
      );

      return mapField(requireField(connection, draft.id, current.id));
    });
  }

  delete(
    spaceIdentity: string,
    draftIdValue: string,
    fieldIdValue: string,
    contextInput: MutationContext
  ): DeleteTemplateDraftFieldResult {
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const spaceId = requireSpaceId(connection, spaceIdentity);
      const draft = requireDraft(connection, spaceId, draftIdValue);
      const current = requireField(connection, draft.id, fieldIdValue);
      connection
        .prepare("DELETE FROM template_draft_fields WHERE id = ? AND draft_id = ?")
        .run(current.id, draft.id);
      const countRow = connection
        .prepare("SELECT COUNT(*) AS count FROM template_draft_fields WHERE draft_id = ?")
        .get(draft.id) as { count: number };
      const remainingFieldCount = Number(countRow.count);
      const repeatBindingCleared =
        remainingFieldCount === 0 && draft.repeat_binding_json !== null;
      const draftVersion = draft.version + 1;
      connection
        .prepare(`
          UPDATE template_drafts
          SET repeat_binding_json = CASE WHEN ? = 1 THEN NULL ELSE repeat_binding_json END,
              version = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(repeatBindingCleared ? 1 : 0, draftVersion, context.now, draft.id);

      this.outbox.append(
        {
          eventType: "template.draft.field.deleted",
          schemaVersion: 1,
          source: "template-draft-field-editor",
          occurredAt: context.now,
          payload: {
            id: current.id,
            draftId: draft.id,
            spaceId,
            key: current.field_key,
            remainingFieldCount,
            repeatBindingCleared,
            draftVersion
          },
          dedupeKey: `template.draft.field.deleted:${current.id}:draft-v${draftVersion}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "delete_field",
          objectType: "template_draft",
          objectId: draft.id,
          correlationId: context.correlationId,
          details: {
            fieldId: current.id,
            key: current.field_key,
            remainingFieldCount,
            repeatBindingCleared,
            draftVersion
          }
        },
        connection
      );
      return { fieldId: current.id, remainingFieldCount, repeatBindingCleared };
    });
  }
}
