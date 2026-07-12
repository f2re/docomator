import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { ContentAddressedObjectStore, type StoredObject } from "./object-store.js";
import { DomainEventOutbox } from "./outbox.js";

export type TemplateTestVersionFormat = "docx" | "xlsx";

export interface RecordTemplateTestVersionInput {
  id?: string;
  spaceId: string;
  draftId: string;
  fieldId: string;
  format: TemplateTestVersionFormat;
  compiledBuffer: Uint8Array;
  trialBuffer: Uint8Array;
  technicalBinding: JsonValue;
  sampleValue: JsonValue;
  renderedValue: string;
  readBackValue: string;
  verification: JsonValue;
}

export interface TemplateTestVersionRecord {
  id: string;
  spaceId: string;
  draftId: string;
  fieldId: string;
  versionNumber: number;
  format: TemplateTestVersionFormat;
  compiledFileId: string;
  trialFileId: string;
  compiledSha256: string;
  trialSha256: string;
  technicalBinding: JsonValue;
  sampleValue: JsonValue;
  renderedValue: string;
  readBackValue: string;
  verification: JsonValue;
  status: "tested";
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
}

interface TestVersionRow {
  id: string;
  space_id: string;
  draft_id: string;
  field_id: string;
  version_number: number;
  format: string;
  compiled_file_id: string;
  trial_file_id: string;
  compiled_sha256: string;
  trial_sha256: string;
  technical_binding_json: string;
  sample_value_json: string;
  rendered_value: string;
  read_back_value: string;
  verification_json: string;
  status: string;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
}

interface DraftFieldRow {
  draft_id: string;
  space_id: string;
  title: string;
  draft_format: string;
  draft_status: string;
  field_id: string;
}

interface FileRow {
  id: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
}

export class TemplateTestVersionValidationError extends Error {
  override readonly name = "TemplateTestVersionValidationError";
}

export class TemplateTestVersionNotFoundError extends Error {
  override readonly name = "TemplateTestVersionNotFoundError";
}

export class TemplateTestVersionConflictError extends Error {
  override readonly name = "TemplateTestVersionConflictError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new TemplateTestVersionValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TemplateTestVersionValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new TemplateTestVersionValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function normalizeFormat(value: string): TemplateTestVersionFormat {
  if (value === "docx" || value === "xlsx") return value;
  throw new TemplateTestVersionValidationError(`Unsupported template format: ${value}`);
}

function normalizeTimestamp(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TemplateTestVersionValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function normalizeContext(context: MutationContext): {
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
    now: normalizeTimestamp(context.now)
  };
}

function mapRecord(row: TestVersionRow): TemplateTestVersionRecord {
  if (row.status !== "tested") {
    throw new Error(`Stored template test status is invalid: ${row.status}`);
  }
  return {
    id: row.id,
    spaceId: row.space_id,
    draftId: row.draft_id,
    fieldId: row.field_id,
    versionNumber: Number(row.version_number),
    format: normalizeFormat(row.format),
    compiledFileId: row.compiled_file_id,
    trialFileId: row.trial_file_id,
    compiledSha256: row.compiled_sha256,
    trialSha256: row.trial_sha256,
    technicalBinding: parseJson(row.technical_binding_json),
    sampleValue: parseJson(row.sample_value_json),
    renderedValue: row.rendered_value,
    readBackValue: row.read_back_value,
    verification: parseJson(row.verification_json),
    status: "tested",
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at
  };
}

function testVersionRow(
  connection: SqliteExecutor,
  spaceId: string,
  versionId: string
): TestVersionRow | undefined {
  return connection
    .prepare(
      "SELECT * FROM template_test_versions WHERE id = ? AND space_id = ?"
    )
    .get(versionId, spaceId) as TestVersionRow | undefined;
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
      throw new TemplateTestVersionConflictError(
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

export class TemplateTestVersionRegistry {
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
    input: RecordTemplateTestVersionInput,
    contextInput: MutationContext
  ): Promise<TemplateTestVersionRecord> {
    const id = input.id ?? randomUUID();
    const spaceId = requiredText(input.spaceId, "spaceId", 160);
    const draftId = requiredText(input.draftId, "draftId", 160);
    const fieldId = requiredText(input.fieldId, "fieldId", 160);
    const format = normalizeFormat(input.format);
    const renderedValue = requiredText(input.renderedValue, "renderedValue", 20_000);
    const readBackValue = requiredText(input.readBackValue, "readBackValue", 20_000);
    if (renderedValue !== readBackValue) {
      throw new TemplateTestVersionValidationError(
        "Rendered value must match the read-back value"
      );
    }
    const technicalBinding = toJsonValue(input.technicalBinding);
    const sampleValue = toJsonValue(input.sampleValue);
    const verification = toJsonValue(input.verification);
    const sampleValueJson = stringifyJson(sampleValue);
    const context = normalizeContext(contextInput);
    const compiledBuffer = Buffer.from(input.compiledBuffer);
    const trialBuffer = Buffer.from(input.trialBuffer);
    if (compiledBuffer.length === 0 || trialBuffer.length === 0) {
      throw new TemplateTestVersionValidationError(
        "Compiled and trial documents must not be empty"
      );
    }

    const compiledStored = await this.objectStore.putBuffer(compiledBuffer);
    const trialStored = await this.objectStore.putBuffer(trialBuffer);

    return this.store.transaction((connection) => {
      const draftField = connection
        .prepare(`
          SELECT
            d.id AS draft_id,
            d.space_id,
            d.title,
            d.format AS draft_format,
            d.status AS draft_status,
            f.id AS field_id
          FROM template_drafts d
          JOIN template_draft_fields f ON f.draft_id = d.id
          WHERE d.id = ? AND d.space_id = ? AND f.id = ?
        `)
        .get(draftId, spaceId, fieldId) as DraftFieldRow | undefined;
      if (draftField === undefined || draftField.draft_status !== "draft") {
        throw new TemplateTestVersionNotFoundError(
          `Template draft field was not found in this space: ${fieldId}`
        );
      }
      if (draftField.draft_format !== format) {
        throw new TemplateTestVersionValidationError(
          "Test version format does not match the template draft"
        );
      }

      const existing = connection
        .prepare(`
          SELECT *
          FROM template_test_versions
          WHERE draft_id = ?
            AND field_id = ?
            AND compiled_sha256 = ?
            AND trial_sha256 = ?
            AND sample_value_json = ?
        `)
        .get(
          draftId,
          fieldId,
          compiledStored.sha256,
          trialStored.sha256,
          sampleValueJson
        ) as TestVersionRow | undefined;
      if (existing !== undefined) return mapRecord(existing);

      const baseName = safeBaseName(draftField.title);
      const mediaType =
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const compiledFile = ensureFile(
        connection,
        compiledStored,
        `${baseName}-техническая-привязка.${format}`,
        mediaType,
        context.now,
        context.actorId
      );
      const trialFile = ensureFile(
        connection,
        trialStored,
        `${baseName}-пробное-заполнение.${format}`,
        mediaType,
        context.now,
        context.actorId
      );
      const current = connection
        .prepare(
          "SELECT COALESCE(MAX(version_number), 0) AS value FROM template_test_versions WHERE draft_id = ?"
        )
        .get(draftId) as { value: number };
      const versionNumber = Number(current.value) + 1;

      connection
        .prepare(`
          INSERT INTO template_test_versions(
            id, space_id, draft_id, field_id, version_number, format,
            compiled_file_id, trial_file_id, compiled_sha256, trial_sha256,
            technical_binding_json, sample_value_json, rendered_value,
            read_back_value, verification_json, status, created_by,
            correlation_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tested', ?, ?, ?)
        `)
        .run(
          id,
          spaceId,
          draftId,
          fieldId,
          versionNumber,
          format,
          compiledFile.id,
          trialFile.id,
          compiledStored.sha256,
          trialStored.sha256,
          stringifyJson(technicalBinding),
          sampleValueJson,
          renderedValue,
          readBackValue,
          stringifyJson(verification),
          context.actorId,
          context.correlationId,
          context.now
        );

      this.outbox.append(
        {
          eventType: "template.test-version.created",
          schemaVersion: 1,
          source: "template-test-version-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId,
            draftId,
            fieldId,
            versionNumber,
            format,
            compiledSha256: compiledStored.sha256,
            trialSha256: trialStored.sha256
          },
          dedupeKey: `template.test-version.created:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "trial_render",
          objectType: "template_draft",
          objectId: draftId,
          correlationId: context.correlationId,
          details: {
            testVersionId: id,
            fieldId,
            versionNumber,
            compiledSha256: compiledStored.sha256,
            trialSha256: trialStored.sha256,
            renderedValue,
            readBackValue
          }
        },
        connection
      );

      const row = testVersionRow(connection, spaceId, id);
      if (row === undefined) {
        throw new Error(`Created template test version was not found: ${id}`);
      }
      return mapRecord(row);
    });
  }

  listVersions(
    spaceIdentity: string,
    draftIdValue: string,
    limitValue = 100
  ): TemplateTestVersionRecord[] {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const draftId = requiredText(draftIdValue, "draftId", 160);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 500) {
      throw new TemplateTestVersionValidationError(
        "limit must be an integer in range 1..500"
      );
    }
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new TemplateTestVersionNotFoundError(`Space was not found: ${identity}`);
      }
      const draft = connection
        .prepare("SELECT id FROM template_drafts WHERE id = ? AND space_id = ?")
        .get(draftId, space.id) as { id: string } | undefined;
      if (draft === undefined) {
        throw new TemplateTestVersionNotFoundError(
          `Template draft was not found in this space: ${draftId}`
        );
      }
      const rows = connection
        .prepare(`
          SELECT * FROM template_test_versions
          WHERE draft_id = ? AND space_id = ?
          ORDER BY version_number DESC, id DESC
          LIMIT ?
        `)
        .all(draftId, space.id, limitValue) as unknown as TestVersionRow[];
      return rows.map(mapRecord);
    });
  }

  getVersion(
    spaceIdentity: string,
    versionIdValue: string
  ): TemplateTestVersionRecord {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const versionId = requiredText(versionIdValue, "versionId", 160);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new TemplateTestVersionNotFoundError(`Space was not found: ${identity}`);
      }
      const row = testVersionRow(connection, space.id, versionId);
      if (row === undefined) {
        throw new TemplateTestVersionNotFoundError(
          `Template test version was not found in this space: ${versionId}`
        );
      }
      return mapRecord(row);
    });
  }
}
