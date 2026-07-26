from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, value: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding="utf-8")
    print(f"updated {path}")


def replace_once(path: str, old: str, new: str) -> None:
    value = read(path)
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:120]!r}")
    write(path, value.replace(old, new, 1))


write(
    "packages/storage/src/template-draft-field-editor.ts",
    r'''import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";
import {
  TemplateDraftConflictError,
  TemplateDraftNotFoundError,
  TemplateDraftRegistry,
  TemplateDraftValidationError,
  type TemplateDraftFieldRecord,
  type TemplateFieldValueType
} from "./template-drafts.js";

export interface UpdateTemplateDraftFieldInput {
  key: string;
  label: string;
  valueType: TemplateFieldValueType;
  required: boolean;
  formatter: JsonValue;
  structureSha256: string;
}

export interface DeleteTemplateDraftFieldResult {
  deletedFieldId: string;
  deletedFieldKey: string;
  repeatBindingCleared: boolean;
}

interface DraftRow {
  id: string;
  space_id: string;
  status: string;
  structure_sha256: string;
  repeat_binding_json: string | null;
  version: number;
}

interface FieldRow {
  id: string;
  draft_id: string;
  field_key: string;
  label: string;
  value_type: string;
  element_id: string;
  version: number;
}

function requiredText(value: string, label: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new TemplateDraftValidationError(`${label} must be a string`);
  }
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new TemplateDraftValidationError(`${label} is invalid`);
  }
  return normalized;
}

function fieldKey(value: string): string {
  const normalized = requiredText(value, "key", 160).toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(normalized)) {
    throw new TemplateDraftValidationError("key is invalid");
  }
  return normalized;
}

function valueType(value: string): TemplateFieldValueType {
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

function contextValue(context: MutationContext): {
  actorType: string;
  actorId: string | null;
  correlationId: string;
  now: string;
} {
  const now = context.now === undefined ? new Date() : new Date(context.now);
  if (Number.isNaN(now.getTime())) {
    throw new TemplateDraftValidationError("Invalid mutation timestamp");
  }
  return {
    actorType: requiredText(context.actorType, "actorType", 80),
    actorId:
      context.actorId === undefined || context.actorId === null
        ? null
        : requiredText(context.actorId, "actorId", 160),
    correlationId: requiredText(context.correlationId, "correlationId", 160),
    now: now.toISOString()
  };
}

function requireSpace(connection: SqliteExecutor, identityValue: string): string {
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
): DraftRow {
  const draftId = requiredText(draftIdValue, "draftId", 160);
  const row = connection
    .prepare(
      "SELECT id, space_id, status, structure_sha256, repeat_binding_json, version FROM template_drafts WHERE id = ? AND space_id = ?"
    )
    .get(draftId, spaceId) as DraftRow | undefined;
  if (row === undefined || row.status !== "draft") {
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
    .prepare(
      "SELECT id, draft_id, field_key, label, value_type, element_id, version FROM template_draft_fields WHERE id = ? AND draft_id = ?"
    )
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
  private readonly drafts: TemplateDraftRegistry;

  constructor(
    private readonly store: SqliteStore,
    options: { audit?: AuditRepository; outbox?: DomainEventOutbox } = {}
  ) {
    this.audit = options.audit ?? new AuditRepository(store);
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.drafts = new TemplateDraftRegistry(store);
  }

  updateField(
    spaceIdentity: string,
    draftIdValue: string,
    fieldIdValue: string,
    input: UpdateTemplateDraftFieldInput,
    contextInput: MutationContext
  ): TemplateDraftFieldRecord {
    const key = fieldKey(input.key);
    const label = requiredText(input.label, "label", 500);
    const type = valueType(input.valueType);
    const formatter = toJsonValue(input.formatter);
    const expectedStructure = requiredText(
      input.structureSha256,
      "structureSha256",
      64
    ).toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(expectedStructure)) {
      throw new TemplateDraftValidationError(
        "structureSha256 must contain 64 hexadecimal characters"
      );
    }
    const context = contextValue(contextInput);
    let draftId = "";
    let fieldId = "";

    this.store.transaction((connection) => {
      const spaceId = requireSpace(connection, spaceIdentity);
      const draft = requireDraft(connection, spaceId, draftIdValue);
      const current = requireField(connection, draft.id, fieldIdValue);
      draftId = draft.id;
      fieldId = current.id;
      if (draft.structure_sha256 !== expectedStructure) {
        throw new TemplateDraftValidationError(
          "Template field does not match the current draft structure"
        );
      }
      const duplicate = connection
        .prepare(
          "SELECT id FROM template_draft_fields WHERE draft_id = ? AND field_key = ? AND id <> ?"
        )
        .get(draft.id, key, current.id) as { id: string } | undefined;
      if (duplicate !== undefined) {
        throw new TemplateDraftConflictError(
          `Template field already exists: ${key}`
        );
      }
      const nextVersion = Number(current.version) + 1;
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
          type,
          input.required ? 1 : 0,
          stringifyJson(formatter),
          nextVersion,
          context.correlationId,
          context.now,
          current.id,
          draft.id
        );
      connection
        .prepare(
          "UPDATE template_drafts SET version = version + 1, correlation_id = ?, updated_at = ? WHERE id = ?"
        )
        .run(context.correlationId, context.now, draft.id);
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
            previousKey: current.field_key,
            key,
            valueType: type,
            version: nextVersion
          },
          dedupeKey: `template.draft.field.updated:${current.id}:v${nextVersion}`,
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
            valueType: type,
            required: input.required,
            version: nextVersion
          }
        },
        connection
      );
    });

    const result = this.drafts
      .getDraft(spaceIdentity, draftId)
      .fields.find((candidate) => candidate.id === fieldId);
    if (result === undefined) {
      throw new TemplateDraftNotFoundError(
        `Template draft field was not found in this space: ${fieldId}`
      );
    }
    return result;
  }

  deleteField(
    spaceIdentity: string,
    draftIdValue: string,
    fieldIdValue: string,
    contextInput: MutationContext
  ): DeleteTemplateDraftFieldResult {
    const context = contextValue(contextInput);
    let result: DeleteTemplateDraftFieldResult | undefined;
    this.store.transaction((connection) => {
      const spaceId = requireSpace(connection, spaceIdentity);
      const draft = requireDraft(connection, spaceId, draftIdValue);
      const field = requireField(connection, draft.id, fieldIdValue);
      connection
        .prepare("DELETE FROM template_draft_fields WHERE id = ? AND draft_id = ?")
        .run(field.id, draft.id);
      const remaining = connection
        .prepare(
          "SELECT COUNT(*) AS count FROM template_draft_fields WHERE draft_id = ?"
        )
        .get(draft.id) as { count: number };
      const repeatBindingCleared =
        Number(remaining.count) === 0 && draft.repeat_binding_json !== null;
      connection
        .prepare(`
          UPDATE template_drafts
          SET repeat_binding_json = CASE WHEN ? = 1 THEN NULL ELSE repeat_binding_json END,
              version = version + 1,
              correlation_id = ?,
              updated_at = ?
          WHERE id = ?
        `)
        .run(
          repeatBindingCleared ? 1 : 0,
          context.correlationId,
          context.now,
          draft.id
        );
      const eventVersion = Number(draft.version) + 1;
      this.outbox.append(
        {
          eventType: "template.draft.field.deleted",
          schemaVersion: 1,
          source: "template-draft-field-editor",
          occurredAt: context.now,
          payload: {
            id: field.id,
            draftId: draft.id,
            spaceId,
            key: field.field_key,
            repeatBindingCleared,
            draftVersion: eventVersion
          },
          dedupeKey: `template.draft.field.deleted:${field.id}:draft-v${eventVersion}`,
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
            fieldId: field.id,
            key: field.field_key,
            repeatBindingCleared,
            draftVersion: eventVersion
          }
        },
        connection
      );
      result = {
        deletedFieldId: field.id,
        deletedFieldKey: field.field_key,
        repeatBindingCleared
      };
    });
    if (result === undefined) {
      throw new Error("Template draft field deletion did not return a result");
    }
    return result;
  }
}
''',
)

write(
    "apps/api/src/template-draft-field-edit-routes.ts",
    r'''import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  defaultScalarFormatter,
  parseScalarFormatter
} from "@docomator/template-compiler";
import {
  TemplateDraftFieldEditor,
  TemplateDraftNotFoundError,
  TemplateDraftRegistry,
  TemplateDraftValidationError,
  toJsonValue
} from "@docomator/storage";

import {
  correlationId,
  mutationContextFromRequest
} from "./request-context.js";

interface FieldParams {
  spaceId: string;
  draftId: string;
  fieldId: string;
}

interface UpdateFieldBody {
  key: string;
  label: string;
  valueType:
    | "string"
    | "text"
    | "enum"
    | "number"
    | "integer"
    | "boolean"
    | "date"
    | "date-time";
  required?: boolean;
  decimalPlaces?: number;
  timeZone?: string;
  personName?: {
    sourceOrder:
      | "family-given-patronymic"
      | "given-patronymic-family"
      | "family-given"
      | "given-family";
    pattern: string;
  };
}

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId", "draftId", "fieldId"],
  properties: {
    spaceId: { type: "string", minLength: 1, maxLength: 160 },
    draftId: { type: "string", minLength: 1, maxLength: 160 },
    fieldId: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

const valueTypeSchema = {
  type: "string",
  enum: [
    "string",
    "text",
    "enum",
    "number",
    "integer",
    "boolean",
    "date",
    "date-time"
  ]
} as const;

function formatterFor(body: UpdateFieldBody) {
  if (
    body.personName !== undefined &&
    body.valueType !== "string" &&
    body.valueType !== "text"
  ) {
    throw new TemplateDraftValidationError(
      "Вариант записи ФИО можно задать только для текстового поля."
    );
  }
  if (body.decimalPlaces !== undefined && body.valueType !== "number") {
    throw new TemplateDraftValidationError(
      "Число знаков после запятой можно задать только для числового поля."
    );
  }
  if (body.timeZone !== undefined && body.valueType !== "date-time") {
    throw new TemplateDraftValidationError(
      "Часовой пояс можно задать только для поля даты и времени."
    );
  }
  return body.personName === undefined
    ? defaultScalarFormatter(body.valueType, {
        ...(body.decimalPlaces === undefined
          ? {}
          : { fractionDigits: body.decimalPlaces }),
        ...(body.timeZone === undefined ? {} : { timeZone: body.timeZone })
      })
    : parseScalarFormatter(body.valueType, {
        version: 1,
        kind: "person-name.ru",
        sourceOrder: body.personName.sourceOrder,
        pattern: body.personName.pattern
      });
}

export function registerTemplateDraftFieldEditRoutes(
  app: FastifyInstance,
  drafts: TemplateDraftRegistry,
  editor: TemplateDraftFieldEditor
): void {
  app.put<{ Params: FieldParams; Body: UpdateFieldBody }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/fields/:fieldId",
    {
      schema: {
        params: paramsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "label", "valueType"],
          properties: {
            key: { type: "string", minLength: 1, maxLength: 160 },
            label: { type: "string", minLength: 1, maxLength: 500 },
            valueType: valueTypeSchema,
            required: { type: "boolean", default: false },
            decimalPlaces: {
              type: "integer",
              minimum: 0,
              maximum: 6
            },
            timeZone: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              pattern: "^(?:UTC|[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+)$"
            },
            personName: {
              type: "object",
              additionalProperties: false,
              required: ["sourceOrder", "pattern"],
              properties: {
                sourceOrder: {
                  type: "string",
                  enum: [
                    "family-given-patronymic",
                    "given-patronymic-family",
                    "family-given",
                    "given-family"
                  ]
                },
                pattern: { type: "string", minLength: 1, maxLength: 160 }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const draft = drafts.getDraft(
        request.params.spaceId,
        request.params.draftId
      );
      if (!draft.fields.some((field) => field.id === request.params.fieldId)) {
        throw new TemplateDraftNotFoundError(
          `Template draft field was not found in this space: ${request.params.fieldId}`
        );
      }
      const field = editor.updateField(
        request.params.spaceId,
        draft.id,
        request.params.fieldId,
        {
          key: request.body.key,
          label: request.body.label,
          valueType: request.body.valueType,
          required: request.body.required ?? false,
          formatter: toJsonValue(formatterFor(request.body)),
          structureSha256: draft.structureSha256
        },
        mutationContextFromRequest(request)
      );
      const current = drafts.getDraft(request.params.spaceId, draft.id);
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, {
        draftId: draft.id,
        structureSha256: draft.structureSha256,
        repeatBinding: current.repeatBinding,
        field
      });
    }
  );

  app.delete<{ Params: FieldParams }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/fields/:fieldId",
    { schema: { params: paramsSchema } },
    async (request, reply) => {
      const result = editor.deleteField(
        request.params.spaceId,
        request.params.draftId,
        request.params.fieldId,
        mutationContextFromRequest(request)
      );
      const current = drafts.getDraft(
        request.params.spaceId,
        request.params.draftId
      );
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, {
        draftId: current.id,
        repeatBinding: current.repeatBinding,
        ...result
      });
    }
  );
}
''',
)

index_path = "packages/storage/src/index.ts"
index = read(index_path)
export_line = 'export * from "./template-draft-field-editor.js";\n'
if export_line not in index:
    marker = 'export * from "./template-drafts.js";\n'
    if marker not in index:
        raise RuntimeError("storage index marker was not found")
    index = index.replace(marker, export_line + marker, 1)
    write(index_path, index)

app_path = "apps/api/src/app.ts"
app = read(app_path)
if "TemplateDraftFieldEditor," not in app:
    marker = "  TemplateDraftConflictError,\n"
    if marker not in app:
        raise RuntimeError("app storage import marker was not found")
    app = app.replace(marker, marker + "  TemplateDraftFieldEditor,\n", 1)
if 'from "./template-draft-field-edit-routes.js"' not in app:
    marker = 'import { registerTemplateDraftRoutes } from "./template-draft-routes.js";\n'
    if marker not in app:
        raise RuntimeError("app route import marker was not found")
    app = app.replace(
        marker,
        'import { registerTemplateDraftFieldEditRoutes } from "./template-draft-field-edit-routes.js";\n' + marker,
        1,
    )
if "templateDraftFieldEditor?: TemplateDraftFieldEditor;" not in app:
    marker = "  templateDraftRegistry?: TemplateDraftRegistry;\n"
    if marker not in app:
        raise RuntimeError("app dependency marker was not found")
    app = app.replace(
        marker,
        marker + "  templateDraftFieldEditor?: TemplateDraftFieldEditor;\n",
        1,
    )
if "const templateDraftFieldEditor =" not in app:
    marker = "  const templateDraftRegistry =\n    dependencies.templateDraftRegistry ?? new TemplateDraftRegistry(store);\n"
    if marker not in app:
        raise RuntimeError("app registry construction marker was not found")
    app = app.replace(
        marker,
        marker
        + "  const templateDraftFieldEditor =\n"
        + "    dependencies.templateDraftFieldEditor ?? new TemplateDraftFieldEditor(store);\n",
        1,
    )
if "registerTemplateDraftFieldEditRoutes(" not in app:
    marker = "  registerTemplateTestVersionRoutes(\n"
    if marker not in app:
        raise RuntimeError("app route registration marker was not found")
    app = app.replace(
        marker,
        "  registerTemplateDraftFieldEditRoutes(\n"
        "    app,\n"
        "    templateDraftRegistry,\n"
        "    templateDraftFieldEditor\n"
        "  );\n"
        + marker,
        1,
    )
write(app_path, app)

message_path = "apps/api/src/user-message.ts"
message = read(message_path)
old = '''  [/^Multi-field trial must provide exactly all draft fields;/i, () =>
    "Для общей проверки заполните все поля текущего черновика без посторонних идентификаторов."],'''
new = '''  [/^Multi-field trial must provide exactly all draft fields;/i, () =>
    "Состав полей черновика изменился после открытия формы. Система обновит список; заполните добавленные поля и повторите проверку."],'''
if old in message:
    message = message.replace(old, new, 1)
elif new not in message:
    raise RuntimeError("multi-field user message marker was not found")
write(message_path, message)

print("server integration prepared")
