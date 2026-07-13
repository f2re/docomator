import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { ContentAddressedObjectStore, type StoredObject } from "./object-store.js";
import { DomainEventOutbox } from "./outbox.js";
import { WorkerQueue, type WorkerJobState } from "./queue.js";

export type TemplatePreviewState = "pending" | "ready" | "failed";
export type ActiveTemplateFormat = "docx" | "xlsx";

export interface RequestTemplatePreviewInput {
  id?: string;
  spaceId: string;
  testVersionId: string;
}

export interface TemplatePreviewRequestRecord {
  id: string;
  spaceId: string;
  testVersionId: string;
  draftId: string;
  title: string;
  format: ActiveTemplateFormat;
  trialSha256: string;
  workerJobId: string;
  workerJobState: WorkerJobState;
  workerAttempts: number;
  workerMaxAttempts: number;
  requestAttempt: number;
  state: TemplatePreviewState;
  previewFileId: string | null;
  previewSha256: string | null;
  converter: JsonValue | null;
  error: JsonValue | null;
  requestedBy: string | null;
  correlationId: string;
  requestedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface CompleteTemplatePreviewInput {
  requestId: string;
  previewBuffer: Uint8Array;
  converter: JsonValue;
}

export interface ActivateTemplateVersionInput {
  id?: string;
  spaceId: string;
  previewRequestId: string;
}

export interface ActiveTemplateRecord {
  id: string;
  spaceId: string;
  draftId: string;
  testVersionId: string;
  previewRequestId: string;
  compiledFileId: string;
  previewFileId: string;
  compiledSha256: string;
  previewSha256: string;
  versionNumber: number;
  title: string;
  format: ActiveTemplateFormat;
  manifest: JsonValue;
  activatedBy: string | null;
  correlationId: string;
  activatedAt: string;
}

interface PreviewRow {
  id: string;
  space_id: string;
  test_version_id: string;
  draft_id: string;
  title: string;
  format: string;
  trial_sha256: string;
  worker_job_id: string;
  worker_state: string;
  worker_attempts: number;
  worker_max_attempts: number;
  request_attempt: number;
  state: string;
  preview_file_id: string | null;
  preview_sha256: string | null;
  converter_json: string | null;
  error_json: string | null;
  requested_by: string | null;
  correlation_id: string;
  requested_at: string;
  completed_at: string | null;
  updated_at: string;
}

interface ActiveRow {
  id: string;
  space_id: string;
  draft_id: string;
  test_version_id: string;
  preview_request_id: string;
  compiled_file_id: string;
  preview_file_id: string;
  compiled_sha256: string;
  preview_sha256: string;
  version_number: number;
  title: string;
  format: string;
  manifest_json: string;
  activated_by: string | null;
  correlation_id: string;
  activated_at: string;
}

interface FileRow {
  id: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
}

interface ActivationSourceRow {
  preview_request_id: string;
  preview_file_id: string;
  preview_sha256: string;
  test_version_id: string;
  compiled_file_id: string;
  compiled_sha256: string;
  draft_id: string;
  space_id: string;
  title: string;
  format: string;
  field_id: string;
  field_key: string;
  field_label: string;
  value_type: string;
  required: number;
  binding_json: string;
  technical_binding_json: string;
}

export class TemplatePreviewValidationError extends Error {
  override readonly name = "TemplatePreviewValidationError";
}

export class TemplatePreviewNotFoundError extends Error {
  override readonly name = "TemplatePreviewNotFoundError";
}

export class TemplatePreviewConflictError extends Error {
  override readonly name = "TemplatePreviewConflictError";
}

export class TemplateActivationValidationError extends Error {
  override readonly name = "TemplateActivationValidationError";
}

export class TemplateActivationNotFoundError extends Error {
  override readonly name = "TemplateActivationNotFoundError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new TemplatePreviewValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TemplatePreviewValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new TemplatePreviewValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TemplatePreviewValidationError("Invalid mutation timestamp");
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

function formatValue(value: string): ActiveTemplateFormat {
  if (value === "docx" || value === "xlsx") return value;
  throw new Error(`Stored template format is invalid: ${value}`);
}

function previewState(value: string): TemplatePreviewState {
  if (value === "pending" || value === "ready" || value === "failed") return value;
  throw new Error(`Stored template preview state is invalid: ${value}`);
}

function workerState(value: string): WorkerJobState {
  if (
    value === "pending" ||
    value === "running" ||
    value === "retry" ||
    value === "completed" ||
    value === "dead_letter"
  ) {
    return value;
  }
  throw new Error(`Stored worker state is invalid: ${value}`);
}

function mapPreview(row: PreviewRow): TemplatePreviewRequestRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    testVersionId: row.test_version_id,
    draftId: row.draft_id,
    title: row.title,
    format: formatValue(row.format),
    trialSha256: row.trial_sha256,
    workerJobId: row.worker_job_id,
    workerJobState: workerState(row.worker_state),
    workerAttempts: Number(row.worker_attempts),
    workerMaxAttempts: Number(row.worker_max_attempts),
    requestAttempt: Number(row.request_attempt),
    state: previewState(row.state),
    previewFileId: row.preview_file_id,
    previewSha256: row.preview_sha256,
    converter: row.converter_json === null ? null : parseJson(row.converter_json),
    error: row.error_json === null ? null : parseJson(row.error_json),
    requestedBy: row.requested_by,
    correlationId: row.correlation_id,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

function mapActive(row: ActiveRow): ActiveTemplateRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    draftId: row.draft_id,
    testVersionId: row.test_version_id,
    previewRequestId: row.preview_request_id,
    compiledFileId: row.compiled_file_id,
    previewFileId: row.preview_file_id,
    compiledSha256: row.compiled_sha256,
    previewSha256: row.preview_sha256,
    versionNumber: Number(row.version_number),
    title: row.title,
    format: formatValue(row.format),
    manifest: parseJson(row.manifest_json),
    activatedBy: row.activated_by,
    correlationId: row.correlation_id,
    activatedAt: row.activated_at
  };
}

function previewSelect(): string {
  return `
    SELECT
      p.*,
      v.draft_id,
      d.title,
      d.format,
      v.trial_sha256,
      j.state AS worker_state,
      j.attempts AS worker_attempts,
      j.max_attempts AS worker_max_attempts
    FROM template_preview_requests p
    JOIN template_test_versions v ON v.id = p.test_version_id
    JOIN template_drafts d ON d.id = v.draft_id
    JOIN worker_jobs j ON j.id = p.worker_job_id
  `;
}

function previewRow(
  connection: SqliteExecutor,
  requestId: string,
  spaceId?: string
): PreviewRow | undefined {
  return connection
    .prepare(
      `${previewSelect()} WHERE p.id = ?${spaceId === undefined ? "" : " AND p.space_id = ?"}`
    )
    .get(...(spaceId === undefined ? [requestId] : [requestId, spaceId])) as
    | PreviewRow
    | undefined;
}

function activeSelect(): string {
  return `
    SELECT
      a.*,
      cf.sha256 AS compiled_sha256,
      pf.sha256 AS preview_sha256
    FROM template_active_versions a
    JOIN files cf ON cf.id = a.compiled_file_id
    JOIN files pf ON pf.id = a.preview_file_id
  `;
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
    .prepare("SELECT id, sha256, size_bytes, storage_path FROM files WHERE sha256 = ?")
    .get(stored.sha256) as FileRow | undefined;
  if (existing !== undefined) {
    if (
      Number(existing.size_bytes) !== stored.sizeBytes ||
      existing.storage_path !== stored.relativePath
    ) {
      throw new TemplatePreviewConflictError(
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

export class TemplatePreviewActivationRegistry {
  private readonly queue: WorkerQueue;
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;

  constructor(
    private readonly store: SqliteStore,
    private readonly objectStore: ContentAddressedObjectStore,
    options: {
      queue?: WorkerQueue;
      outbox?: DomainEventOutbox;
      audit?: AuditRepository;
    } = {}
  ) {
    this.queue = options.queue ?? new WorkerQueue(store);
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
  }

  requestPreview(
    input: RequestTemplatePreviewInput,
    contextInput: MutationContext
  ): { request: TemplatePreviewRequestRecord; created: boolean; retried: boolean } {
    const id = input.id ?? randomUUID();
    const spaceId = requiredText(input.spaceId, "spaceId", 160);
    const testVersionId = requiredText(input.testVersionId, "testVersionId", 160);
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const version = connection
        .prepare("SELECT id FROM template_test_versions WHERE id = ? AND space_id = ?")
        .get(testVersionId, spaceId) as { id: string } | undefined;
      if (version === undefined) {
        throw new TemplatePreviewNotFoundError(
          `Template test version was not found in this space: ${testVersionId}`
        );
      }

      const existing = connection
        .prepare("SELECT id, state, request_attempt FROM template_preview_requests WHERE space_id = ? AND test_version_id = ?")
        .get(spaceId, testVersionId) as
        | { id: string; state: string; request_attempt: number }
        | undefined;
      if (existing !== undefined && existing.state !== "failed") {
        const row = previewRow(connection, existing.id, spaceId);
        if (row === undefined) throw new Error(`Preview request was not found: ${existing.id}`);
        return { request: mapPreview(row), created: false, retried: false };
      }

      const requestId = existing?.id ?? id;
      const attempt = existing === undefined ? 1 : Number(existing.request_attempt) + 1;
      const queued = this.queue.enqueue(
        {
          jobType: "template.preview",
          payload: toJsonValue({
            previewRequestId: requestId,
            spaceId,
            testVersionId,
            attempt
          }),
          priority: 70,
          maxAttempts: 1,
          idempotencyKey: `template.preview:${requestId}:attempt:${attempt}`,
          now: context.now
        },
        connection
      );

      if (existing === undefined) {
        connection
          .prepare(`
            INSERT INTO template_preview_requests(
              id, space_id, test_version_id, worker_job_id, request_attempt,
              state, preview_file_id, preview_sha256, converter_json,
              error_json, requested_by, correlation_id, requested_at,
              completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, ?, ?, NULL, ?)
          `)
          .run(
            requestId,
            spaceId,
            testVersionId,
            queued.job.id,
            attempt,
            context.actorId,
            context.correlationId,
            context.now,
            context.now
          );
      } else {
        connection
          .prepare(`
            UPDATE template_preview_requests
            SET worker_job_id = ?, request_attempt = ?, state = 'pending',
                preview_file_id = NULL, preview_sha256 = NULL,
                converter_json = NULL, error_json = NULL,
                requested_by = ?, correlation_id = ?, requested_at = ?,
                completed_at = NULL, updated_at = ?
            WHERE id = ? AND state = 'failed'
          `)
          .run(
            queued.job.id,
            attempt,
            context.actorId,
            context.correlationId,
            context.now,
            context.now,
            requestId
          );
      }

      this.outbox.append(
        {
          eventType: "template.preview.requested",
          schemaVersion: 1,
          source: "template-preview-activation-registry",
          occurredAt: context.now,
          payload: { requestId, spaceId, testVersionId, attempt, workerJobId: queued.job.id },
          dedupeKey: `template.preview.requested:${requestId}:attempt:${attempt}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: existing === undefined ? "request_preview" : "retry_preview",
          objectType: "template_test_version",
          objectId: testVersionId,
          correlationId: context.correlationId,
          details: { requestId, attempt, workerJobId: queued.job.id }
        },
        connection
      );

      const row = previewRow(connection, requestId, spaceId);
      if (row === undefined) throw new Error(`Created preview request was not found: ${requestId}`);
      return {
        request: mapPreview(row),
        created: existing === undefined,
        retried: existing !== undefined
      };
    });
  }

  getPreview(spaceIdentity: string, requestIdValue: string): TemplatePreviewRequestRecord {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const requestId = requiredText(requestIdValue, "requestId", 160);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new TemplatePreviewNotFoundError(`Space was not found: ${identity}`);
      }
      const row = previewRow(connection, requestId, space.id);
      if (row === undefined) {
        throw new TemplatePreviewNotFoundError(
          `Template preview was not found in this space: ${requestId}`
        );
      }
      return mapPreview(row);
    });
  }

  getPreviewForWorker(requestIdValue: string): TemplatePreviewRequestRecord {
    const requestId = requiredText(requestIdValue, "requestId", 160);
    return this.store.execute((connection) => {
      const row = previewRow(connection, requestId);
      if (row === undefined) {
        throw new TemplatePreviewNotFoundError(`Template preview was not found: ${requestId}`);
      }
      return mapPreview(row);
    });
  }

  async completePreview(
    input: CompleteTemplatePreviewInput,
    contextInput: MutationContext
  ): Promise<TemplatePreviewRequestRecord> {
    const requestId = requiredText(input.requestId, "requestId", 160);
    const context = contextValue(contextInput);
    const pdf = Buffer.from(input.previewBuffer);
    if (pdf.length < 8 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new TemplatePreviewValidationError(
        "LibreOffice did not produce a valid PDF preview"
      );
    }
    if (pdf.length > 128 * 1024 * 1024) {
      throw new TemplatePreviewValidationError("PDF preview exceeds the 128 MB limit");
    }
    const converter = toJsonValue(input.converter);
    const stored = await this.objectStore.putBuffer(pdf);

    return this.store.transaction((connection) => {
      const current = previewRow(connection, requestId);
      if (current === undefined) {
        throw new TemplatePreviewNotFoundError(`Template preview was not found: ${requestId}`);
      }
      if (current.state === "ready") {
        if (current.preview_sha256 !== stored.sha256) {
          throw new TemplatePreviewConflictError(
            "Ready preview already points to another PDF"
          );
        }
        return mapPreview(current);
      }
      const file = ensureFile(
        connection,
        stored,
        `предварительный-просмотр-${requestId}.pdf`,
        "application/pdf",
        context.now,
        context.actorId
      );
      connection
        .prepare(`
          UPDATE template_preview_requests
          SET state = 'ready', preview_file_id = ?, preview_sha256 = ?,
              converter_json = ?, error_json = NULL,
              completed_at = ?, updated_at = ?
          WHERE id = ? AND state = 'pending'
        `)
        .run(
          file.id,
          stored.sha256,
          stringifyJson(converter),
          context.now,
          context.now,
          requestId
        );

      this.outbox.append(
        {
          eventType: "template.preview.ready",
          schemaVersion: 1,
          source: "template-preview-activation-registry",
          occurredAt: context.now,
          payload: { requestId, previewFileId: file.id, previewSha256: stored.sha256 },
          dedupeKey: `template.preview.ready:${requestId}:${stored.sha256}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "complete_preview",
          objectType: "template_preview",
          objectId: requestId,
          correlationId: context.correlationId,
          details: { previewFileId: file.id, previewSha256: stored.sha256 }
        },
        connection
      );

      const row = previewRow(connection, requestId);
      if (row === undefined) throw new Error(`Completed preview was not found: ${requestId}`);
      return mapPreview(row);
    });
  }

  failPreview(
    requestIdValue: string,
    errorValue: JsonValue,
    contextInput: MutationContext
  ): TemplatePreviewRequestRecord {
    const requestId = requiredText(requestIdValue, "requestId", 160);
    const error = toJsonValue(errorValue);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = previewRow(connection, requestId);
      if (current === undefined) {
        throw new TemplatePreviewNotFoundError(`Template preview was not found: ${requestId}`);
      }
      if (current.state === "ready") {
        throw new TemplatePreviewConflictError(
          "Ready preview cannot be replaced with a failure"
        );
      }
      connection
        .prepare(`
          UPDATE template_preview_requests
          SET state = 'failed', error_json = ?, completed_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(stringifyJson(error), context.now, context.now, requestId);
      this.outbox.append(
        {
          eventType: "template.preview.failed",
          schemaVersion: 1,
          source: "template-preview-activation-registry",
          occurredAt: context.now,
          payload: { requestId, error },
          dedupeKey: `template.preview.failed:${requestId}:attempt:${current.request_attempt}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "fail_preview",
          objectType: "template_preview",
          objectId: requestId,
          correlationId: context.correlationId,
          details: { error }
        },
        connection
      );
      const row = previewRow(connection, requestId);
      if (row === undefined) throw new Error(`Failed preview was not found: ${requestId}`);
      return mapPreview(row);
    });
  }

  activateVersion(
    input: ActivateTemplateVersionInput,
    contextInput: MutationContext
  ): ActiveTemplateRecord {
    const id = input.id ?? randomUUID();
    const spaceId = requiredText(input.spaceId, "spaceId", 160);
    const previewRequestId = requiredText(
      input.previewRequestId,
      "previewRequestId",
      160
    );
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const source = connection
        .prepare(`
          SELECT
            p.id AS preview_request_id,
            p.preview_file_id,
            p.preview_sha256,
            v.id AS test_version_id,
            v.compiled_file_id,
            v.compiled_sha256,
            d.id AS draft_id,
            d.space_id,
            d.title,
            d.format,
            f.id AS field_id,
            f.field_key,
            f.label AS field_label,
            f.value_type,
            f.required,
            f.binding_json,
            v.technical_binding_json
          FROM template_preview_requests p
          JOIN template_test_versions v ON v.id = p.test_version_id
          JOIN template_drafts d ON d.id = v.draft_id
          JOIN template_draft_fields f ON f.id = v.field_id
          WHERE p.id = ?
            AND p.space_id = ?
            AND p.state = 'ready'
            AND p.preview_file_id IS NOT NULL
            AND p.preview_sha256 IS NOT NULL
        `)
        .get(previewRequestId, spaceId) as ActivationSourceRow | undefined;
      if (source === undefined) {
        throw new TemplateActivationNotFoundError(
          `Ready template preview was not found in this space: ${previewRequestId}`
        );
      }

      const existing = connection
        .prepare(`${activeSelect()} WHERE a.draft_id = ? AND a.test_version_id = ?`)
        .get(source.draft_id, source.test_version_id) as ActiveRow | undefined;
      if (existing !== undefined) {
        connection
          .prepare(`
            INSERT INTO template_active_pointers(
              draft_id, space_id, active_version_id, updated_by,
              correlation_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(draft_id) DO UPDATE SET
              space_id = excluded.space_id,
              active_version_id = excluded.active_version_id,
              updated_by = excluded.updated_by,
              correlation_id = excluded.correlation_id,
              updated_at = excluded.updated_at
          `)
          .run(
            source.draft_id,
            spaceId,
            existing.id,
            context.actorId,
            context.correlationId,
            context.now
          );
        return mapActive(existing);
      }

      const current = connection
        .prepare(
          "SELECT COALESCE(MAX(version_number), 0) AS value FROM template_active_versions WHERE draft_id = ?"
        )
        .get(source.draft_id) as { value: number };
      const versionNumber = Number(current.value) + 1;
      const manifest = toJsonValue({
        version: 1,
        draftId: source.draft_id,
        title: source.title,
        format: source.format,
        testVersionId: source.test_version_id,
        compiledSha256: source.compiled_sha256,
        previewSha256: source.preview_sha256,
        fields: [
          {
            id: source.field_id,
            key: source.field_key,
            label: source.field_label,
            valueType: source.value_type,
            required: source.required === 1,
            binding: parseJson(source.binding_json),
            technicalBinding: parseJson(source.technical_binding_json)
          }
        ]
      });

      connection
        .prepare(`
          INSERT INTO template_active_versions(
            id, space_id, draft_id, test_version_id, preview_request_id,
            compiled_file_id, preview_file_id, version_number, title,
            format, manifest_json, activated_by, correlation_id, activated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          spaceId,
          source.draft_id,
          source.test_version_id,
          source.preview_request_id,
          source.compiled_file_id,
          source.preview_file_id,
          versionNumber,
          source.title,
          source.format,
          stringifyJson(manifest),
          context.actorId,
          context.correlationId,
          context.now
        );
      connection
        .prepare(`
          INSERT INTO template_active_pointers(
            draft_id, space_id, active_version_id, updated_by,
            correlation_id, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(draft_id) DO UPDATE SET
            space_id = excluded.space_id,
            active_version_id = excluded.active_version_id,
            updated_by = excluded.updated_by,
            correlation_id = excluded.correlation_id,
            updated_at = excluded.updated_at
        `)
        .run(
          source.draft_id,
          spaceId,
          id,
          context.actorId,
          context.correlationId,
          context.now
        );

      this.outbox.append(
        {
          eventType: "template.version.activated",
          schemaVersion: 1,
          source: "template-preview-activation-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId,
            draftId: source.draft_id,
            testVersionId: source.test_version_id,
            previewRequestId,
            versionNumber
          },
          dedupeKey: `template.version.activated:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "activate",
          objectType: "template_version",
          objectId: id,
          correlationId: context.correlationId,
          details: {
            spaceId,
            draftId: source.draft_id,
            testVersionId: source.test_version_id,
            previewRequestId,
            versionNumber
          }
        },
        connection
      );

      const row = connection
        .prepare(`${activeSelect()} WHERE a.id = ? AND a.space_id = ?`)
        .get(id, spaceId) as ActiveRow | undefined;
      if (row === undefined) throw new Error(`Activated template was not found: ${id}`);
      return mapActive(row);
    });
  }

  listActiveTemplates(spaceIdentity: string): ActiveTemplateRecord[] {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new TemplateActivationNotFoundError(`Space was not found: ${identity}`);
      }
      const rows = connection
        .prepare(`
          ${activeSelect()}
          JOIN template_active_pointers pointer
            ON pointer.active_version_id = a.id
           AND pointer.draft_id = a.draft_id
          WHERE a.space_id = ?
          ORDER BY a.title COLLATE NOCASE, a.activated_at DESC, a.id
        `)
        .all(space.id) as unknown as ActiveRow[];
      return rows.map(mapActive);
    });
  }

  getActiveTemplate(spaceIdentity: string, activeVersionIdValue: string): ActiveTemplateRecord {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const activeVersionId = requiredText(activeVersionIdValue, "activeVersionId", 160);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new TemplateActivationNotFoundError(`Space was not found: ${identity}`);
      }
      const row = connection
        .prepare(`${activeSelect()} WHERE a.id = ? AND a.space_id = ?`)
        .get(activeVersionId, space.id) as ActiveRow | undefined;
      if (row === undefined) {
        throw new TemplateActivationNotFoundError(
          `Active template version was not found in this space: ${activeVersionId}`
        );
      }
      return mapActive(row);
    });
  }
}
