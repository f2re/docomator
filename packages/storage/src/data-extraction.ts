import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";

export type DataExtractionFormat = "docx" | "xlsx";

export interface CreateDataExtractionTemplateInput {
  id?: string;
  spaceId: string;
  title: string;
  format: DataExtractionFormat;
  sampleSourceRecordId: string;
  sampleSha256: string;
  structureSha256: string;
  definition: JsonValue;
}

export interface DataExtractionTemplateRecord {
  id: string;
  spaceId: string;
  title: string;
  format: DataExtractionFormat;
  sampleSourceRecordId: string;
  sampleSha256: string;
  structureSha256: string;
  definition: JsonValue;
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
}

export interface CreateDataExtractionItemInput {
  id?: string;
  sourceRecordId: string;
  sourceName: string;
  sourceSha256: string;
  result: JsonValue;
  issues: JsonValue;
}

export interface CreateDataExtractionRunInput {
  id?: string;
  spaceId: string;
  templateId: string;
  idempotencyKey: string;
  templateSnapshot: JsonValue;
  items: readonly CreateDataExtractionItemInput[];
}

export interface DataExtractionItemRecord {
  id: string;
  runId: string;
  spaceId: string;
  position: number;
  sourceRecordId: string;
  sourceName: string;
  sourceSha256: string;
  result: JsonValue;
  issues: JsonValue;
  corrections: JsonValue;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DataExtractionRunRecord {
  id: string;
  spaceId: string;
  templateId: string;
  idempotencyKey: string;
  templateSnapshot: JsonValue;
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  items: DataExtractionItemRecord[];
}

interface TemplateRow {
  id: string;
  space_id: string;
  title: string;
  format: string;
  sample_source_record_id: string;
  sample_sha256: string;
  structure_sha256: string;
  definition_json: string;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
}

interface RunRow {
  id: string;
  space_id: string;
  template_id: string;
  idempotency_key: string;
  template_snapshot_json: string;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  run_id: string;
  space_id: string;
  position: number;
  source_record_id: string;
  source_name: string;
  source_sha256: string;
  result_json: string;
  issues_json: string;
  corrections_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export class DataExtractionValidationError extends Error {
  override readonly name = "DataExtractionValidationError";
}

export class DataExtractionNotFoundError extends Error {
  override readonly name = "DataExtractionNotFoundError";
}

export class DataExtractionConflictError extends Error {
  override readonly name = "DataExtractionConflictError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new DataExtractionValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DataExtractionValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new DataExtractionValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function normalizeSha256(value: string, name: string): string {
  const normalized = requiredText(value, name, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DataExtractionValidationError(
      `${name} must contain 64 hexadecimal characters`
    );
  }
  return normalized;
}

function normalizeFormat(value: string): DataExtractionFormat {
  if (value === "docx" || value === "xlsx") return value;
  throw new DataExtractionValidationError(`Unsupported data extraction format: ${value}`);
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new DataExtractionValidationError("limit must be an integer in range 1..500");
  }
  return limit;
}

function timestamp(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DataExtractionValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function contextValue(context: MutationContext) {
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

function jsonObject(value: JsonValue, name: string): JsonValue {
  const normalized = toJsonValue(value);
  if (normalized === null || typeof normalized !== "object" || Array.isArray(normalized)) {
    throw new DataExtractionValidationError(`${name} must be a JSON object`);
  }
  return normalized;
}

function resolveSpace(connection: SqliteExecutor, identity: string): string {
  const normalized = requiredText(identity, "spaceId", 160);
  const row = connection
    .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
    .get(normalized, normalized.toLowerCase()) as { id: string } | undefined;
  if (row === undefined) {
    throw new DataExtractionNotFoundError(`Space was not found: ${normalized}`);
  }
  return row.id;
}

function mapTemplate(row: TemplateRow): DataExtractionTemplateRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    title: row.title,
    format: normalizeFormat(row.format),
    sampleSourceRecordId: row.sample_source_record_id,
    sampleSha256: row.sample_sha256,
    structureSha256: row.structure_sha256,
    definition: parseJson(row.definition_json),
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at
  };
}

function mapItem(row: ItemRow): DataExtractionItemRecord {
  return {
    id: row.id,
    runId: row.run_id,
    spaceId: row.space_id,
    position: Number(row.position),
    sourceRecordId: row.source_record_id,
    sourceName: row.source_name,
    sourceSha256: row.source_sha256,
    result: parseJson(row.result_json),
    issues: parseJson(row.issues_json),
    corrections: parseJson(row.corrections_json),
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function runItems(connection: SqliteExecutor, runId: string): DataExtractionItemRecord[] {
  const rows = connection
    .prepare(`
      SELECT *
      FROM data_extraction_items
      WHERE run_id = ?
      ORDER BY position ASC, id ASC
    `)
    .all(runId) as unknown as ItemRow[];
  return rows.map(mapItem);
}

function mapRun(connection: SqliteExecutor, row: RunRow): DataExtractionRunRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    templateId: row.template_id,
    idempotencyKey: row.idempotency_key,
    templateSnapshot: parseJson(row.template_snapshot_json),
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: runItems(connection, row.id)
  };
}

export class DataExtractionRegistry {
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;

  constructor(
    private readonly store: SqliteStore,
    options: { outbox?: DomainEventOutbox; audit?: AuditRepository } = {}
  ) {
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
  }

  createTemplate(
    input: CreateDataExtractionTemplateInput,
    contextInput: MutationContext
  ): DataExtractionTemplateRecord {
    const id = input.id ?? randomUUID();
    const title = requiredText(input.title, "title", 500);
    const format = normalizeFormat(input.format);
    const sourceRecordId = requiredText(
      input.sampleSourceRecordId,
      "sampleSourceRecordId",
      160
    );
    const sampleSha256 = normalizeSha256(input.sampleSha256, "sampleSha256");
    const structureSha256 = normalizeSha256(input.structureSha256, "structureSha256");
    const definition = jsonObject(input.definition, "definition");
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const spaceId = resolveSpace(connection, input.spaceId);
      const source = connection
        .prepare(`
          SELECT q.id, q.format, f.sha256
          FROM document_quarantine_records q
          JOIN files f ON f.id = q.file_id
          WHERE q.id = ? AND q.space_id = ?
        `)
        .get(sourceRecordId, spaceId) as
        | { id: string; format: string; sha256: string }
        | undefined;
      if (source === undefined) {
        throw new DataExtractionNotFoundError(
          `Data extraction source was not found in this space: ${sourceRecordId}`
        );
      }
      if (source.format !== format || source.sha256 !== sampleSha256) {
        throw new DataExtractionValidationError(
          "Data extraction template source no longer matches the verified document"
        );
      }

      connection
        .prepare(`
          INSERT INTO data_extraction_templates(
            id, space_id, title, format, sample_source_record_id,
            sample_sha256, structure_sha256, definition_json,
            created_by, correlation_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          spaceId,
          title,
          format,
          sourceRecordId,
          sampleSha256,
          structureSha256,
          stringifyJson(definition),
          context.actorId,
          context.correlationId,
          context.now
        );

      this.outbox.append(
        {
          eventType: "data_extraction.template_created",
          schemaVersion: 1,
          source: "data-extraction-registry",
          occurredAt: context.now,
          payload: { id, spaceId, sourceRecordId, format },
          dedupeKey: `data_extraction.template_created:${id}:v1`,
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
          objectType: "data_extraction_template",
          objectId: id,
          correlationId: context.correlationId,
          details: { spaceId, sourceRecordId, format }
        },
        connection
      );

      const row = connection
        .prepare("SELECT * FROM data_extraction_templates WHERE id = ? AND space_id = ?")
        .get(id, spaceId) as TemplateRow | undefined;
      if (row === undefined) throw new Error(`Created extraction template was not found: ${id}`);
      return mapTemplate(row);
    });
  }

  listTemplates(spaceIdentity: string, limitValue?: number): DataExtractionTemplateRecord[] {
    const limit = normalizeLimit(limitValue);
    return this.store.execute((connection) => {
      const spaceId = resolveSpace(connection, spaceIdentity);
      const rows = connection
        .prepare(`
          SELECT * FROM data_extraction_templates
          WHERE space_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `)
        .all(spaceId, limit) as unknown as TemplateRow[];
      return rows.map(mapTemplate);
    });
  }

  getTemplate(spaceIdentity: string, templateIdValue: string): DataExtractionTemplateRecord {
    const templateId = requiredText(templateIdValue, "templateId", 160);
    return this.store.execute((connection) => {
      const spaceId = resolveSpace(connection, spaceIdentity);
      const row = connection
        .prepare("SELECT * FROM data_extraction_templates WHERE id = ? AND space_id = ?")
        .get(templateId, spaceId) as TemplateRow | undefined;
      if (row === undefined) {
        throw new DataExtractionNotFoundError(
          `Data extraction template was not found in this space: ${templateId}`
        );
      }
      return mapTemplate(row);
    });
  }

  createOrGetRun(
    input: CreateDataExtractionRunInput,
    contextInput: MutationContext
  ): DataExtractionRunRecord {
    const id = input.id ?? randomUUID();
    const templateId = requiredText(input.templateId, "templateId", 160);
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 200);
    const templateSnapshot = jsonObject(input.templateSnapshot, "templateSnapshot");
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
      throw new DataExtractionValidationError("items must contain between 1 and 100 documents");
    }
    const context = contextValue(contextInput);
    const normalizedItems = input.items.map((item, position) => ({
      id: item.id ?? randomUUID(),
      position,
      sourceRecordId: requiredText(item.sourceRecordId, "sourceRecordId", 160),
      sourceName: requiredText(item.sourceName, "sourceName", 255),
      sourceSha256: normalizeSha256(item.sourceSha256, "sourceSha256"),
      result: jsonObject(item.result, "result"),
      issues: toJsonValue(item.issues)
    }));
    if (new Set(normalizedItems.map((item) => item.sourceRecordId)).size !== normalizedItems.length) {
      throw new DataExtractionValidationError("sourceRecordIds must be unique within a run");
    }

    return this.store.transaction((connection) => {
      const spaceId = resolveSpace(connection, input.spaceId);
      const template = connection
        .prepare("SELECT * FROM data_extraction_templates WHERE id = ? AND space_id = ?")
        .get(templateId, spaceId) as TemplateRow | undefined;
      if (template === undefined) {
        throw new DataExtractionNotFoundError(
          `Data extraction template was not found in this space: ${templateId}`
        );
      }

      const existing = connection
        .prepare("SELECT * FROM data_extraction_runs WHERE space_id = ? AND idempotency_key = ?")
        .get(spaceId, idempotencyKey) as RunRow | undefined;
      if (existing !== undefined) {
        const record = mapRun(connection, existing);
        const requestedSources = normalizedItems.map((item) => item.sourceRecordId);
        const storedSources = record.items.map((item) => item.sourceRecordId);
        if (
          record.templateId !== templateId ||
          stringifyJson(record.templateSnapshot) !== stringifyJson(templateSnapshot) ||
          stringifyJson(storedSources) !== stringifyJson(requestedSources)
        ) {
          throw new DataExtractionConflictError(
            `Data extraction idempotency key was reused with different input: ${idempotencyKey}`
          );
        }
        return record;
      }

      for (const item of normalizedItems) {
        const source = connection
          .prepare(`
            SELECT q.id, q.original_name, f.sha256
            FROM document_quarantine_records q
            JOIN files f ON f.id = q.file_id
            WHERE q.id = ? AND q.space_id = ?
          `)
          .get(item.sourceRecordId, spaceId) as
          | { id: string; original_name: string; sha256: string }
          | undefined;
        if (source === undefined) {
          throw new DataExtractionNotFoundError(
            `Data extraction source was not found in this space: ${item.sourceRecordId}`
          );
        }
        if (source.sha256 !== item.sourceSha256 || source.original_name !== item.sourceName) {
          throw new DataExtractionValidationError(
            "Data extraction source changed before the run was saved"
          );
        }
      }

      connection
        .prepare(`
          INSERT INTO data_extraction_runs(
            id, space_id, template_id, idempotency_key, template_snapshot_json,
            created_by, correlation_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          spaceId,
          templateId,
          idempotencyKey,
          stringifyJson(templateSnapshot),
          context.actorId,
          context.correlationId,
          context.now,
          context.now
        );

      const insert = connection.prepare(`
        INSERT INTO data_extraction_items(
          id, run_id, space_id, position, source_record_id, source_name,
          source_sha256, result_json, issues_json, corrections_json,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', 1, ?, ?)
      `);
      for (const item of normalizedItems) {
        insert.run(
          item.id,
          id,
          spaceId,
          item.position,
          item.sourceRecordId,
          item.sourceName,
          item.sourceSha256,
          stringifyJson(item.result),
          stringifyJson(item.issues),
          context.now,
          context.now
        );
      }

      this.outbox.append(
        {
          eventType: "data_extraction.run_created",
          schemaVersion: 1,
          source: "data-extraction-registry",
          occurredAt: context.now,
          payload: { id, spaceId, templateId, itemCount: normalizedItems.length },
          dedupeKey: `data_extraction.run_created:${id}:v1`,
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
          objectType: "data_extraction_run",
          objectId: id,
          correlationId: context.correlationId,
          details: { spaceId, templateId, itemCount: normalizedItems.length }
        },
        connection
      );

      const row = connection
        .prepare("SELECT * FROM data_extraction_runs WHERE id = ? AND space_id = ?")
        .get(id, spaceId) as RunRow | undefined;
      if (row === undefined) throw new Error(`Created extraction run was not found: ${id}`);
      return mapRun(connection, row);
    });
  }

  getRun(spaceIdentity: string, runIdValue: string): DataExtractionRunRecord {
    const runId = requiredText(runIdValue, "runId", 160);
    return this.store.execute((connection) => {
      const spaceId = resolveSpace(connection, spaceIdentity);
      const row = connection
        .prepare("SELECT * FROM data_extraction_runs WHERE id = ? AND space_id = ?")
        .get(runId, spaceId) as RunRow | undefined;
      if (row === undefined) {
        throw new DataExtractionNotFoundError(
          `Data extraction run was not found in this space: ${runId}`
        );
      }
      return mapRun(connection, row);
    });
  }

  listRuns(spaceIdentity: string, limitValue?: number): DataExtractionRunRecord[] {
    const limit = normalizeLimit(limitValue);
    return this.store.execute((connection) => {
      const spaceId = resolveSpace(connection, spaceIdentity);
      const rows = connection
        .prepare(`
          SELECT * FROM data_extraction_runs
          WHERE space_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `)
        .all(spaceId, limit) as unknown as RunRow[];
      return rows.map((row) => mapRun(connection, row));
    });
  }

  replaceItemCorrections(
    spaceIdentity: string,
    runIdValue: string,
    itemIdValue: string,
    correctionsInput: JsonValue,
    expectedVersion: number,
    contextInput: MutationContext
  ): DataExtractionItemRecord {
    const runId = requiredText(runIdValue, "runId", 160);
    const itemId = requiredText(itemIdValue, "itemId", 160);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new DataExtractionValidationError("expectedVersion must be a positive integer");
    }
    const corrections = jsonObject(correctionsInput, "corrections");
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const spaceId = resolveSpace(connection, spaceIdentity);
      const row = connection
        .prepare(`
          SELECT item.*
          FROM data_extraction_items item
          JOIN data_extraction_runs run ON run.id = item.run_id
          WHERE item.id = ? AND item.run_id = ?
            AND item.space_id = ? AND run.space_id = ?
        `)
        .get(itemId, runId, spaceId, spaceId) as ItemRow | undefined;
      if (row === undefined) {
        throw new DataExtractionNotFoundError(
          `Data extraction item was not found in this space: ${itemId}`
        );
      }
      if (Number(row.version) !== expectedVersion) {
        throw new DataExtractionConflictError(
          `Data extraction item changed before correction: ${itemId}`
        );
      }
      const changed = connection
        .prepare(`
          UPDATE data_extraction_items
          SET corrections_json = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND run_id = ? AND space_id = ? AND version = ?
        `)
        .run(
          stringifyJson(corrections),
          context.now,
          itemId,
          runId,
          spaceId,
          expectedVersion
        );
      if (Number(changed.changes) !== 1) {
        throw new DataExtractionConflictError(
          `Data extraction item changed before correction: ${itemId}`
        );
      }
      connection
        .prepare("UPDATE data_extraction_runs SET updated_at = ? WHERE id = ? AND space_id = ?")
        .run(context.now, runId, spaceId);

      this.outbox.append(
        {
          eventType: "data_extraction.item_corrected",
          schemaVersion: 1,
          source: "data-extraction-registry",
          occurredAt: context.now,
          payload: { runId, itemId, spaceId, version: expectedVersion + 1 },
          dedupeKey: `data_extraction.item_corrected:${itemId}:v${expectedVersion + 1}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "correct",
          objectType: "data_extraction_item",
          objectId: itemId,
          correlationId: context.correlationId,
          details: { runId, spaceId, version: expectedVersion + 1 }
        },
        connection
      );

      const updated = connection
        .prepare("SELECT * FROM data_extraction_items WHERE id = ? AND run_id = ? AND space_id = ?")
        .get(itemId, runId, spaceId) as ItemRow | undefined;
      if (updated === undefined) throw new Error(`Corrected extraction item was not found: ${itemId}`);
      return mapItem(updated);
    });
  }
}
