import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { ContentAddressedObjectStore, type StoredObject } from "./object-store.js";
import { DomainEventOutbox } from "./outbox.js";
import { WorkerQueue, type WorkerJobState } from "./queue.js";
import {
  TemplateActivationNotFoundError,
  TemplatePreviewConflictError,
  TemplatePreviewNotFoundError,
  TemplatePreviewValidationError
} from "./template-preview-activation.js";

export type TemplateReleaseCandidateKind = "single" | "multi";
export type TemplateReleasePreviewState = "pending" | "ready" | "failed";
export type ActiveTemplateReleaseFormat = "docx" | "xlsx";

export interface RequestTemplateReleasePreviewInput {
  id?: string;
  spaceId: string;
  versionId: string;
  versionKind: TemplateReleaseCandidateKind;
}

export interface TemplateReleasePreviewRecord {
  id: string;
  spaceId: string;
  versionId: string;
  versionKind: TemplateReleaseCandidateKind;
  sourceVersionNumber: number;
  draftId: string;
  title: string;
  format: ActiveTemplateReleaseFormat;
  fieldCount: number;
  trialSha256: string;
  workerJobId: string;
  workerJobState: WorkerJobState;
  workerAttempts: number;
  workerMaxAttempts: number;
  requestAttempt: number;
  state: TemplateReleasePreviewState;
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

export interface CompleteTemplateReleasePreviewInput {
  requestId: string;
  previewBuffer: Uint8Array;
  converter: JsonValue;
}

export interface ActivateTemplateReleaseInput {
  id?: string;
  spaceId: string;
  previewRequestId: string;
}

export interface ActiveTemplateReleaseRecord {
  id: string;
  spaceId: string;
  draftId: string;
  versionId: string;
  versionKind: TemplateReleaseCandidateKind;
  sourceVersionNumber: number;
  fieldCount: number;
  previewRequestId: string;
  compiledFileId: string;
  previewFileId: string;
  compiledSha256: string;
  previewSha256: string;
  versionNumber: number;
  title: string;
  format: ActiveTemplateReleaseFormat;
  manifest: JsonValue;
  activatedBy: string | null;
  correlationId: string;
  activatedAt: string;
}

interface PreviewRow {
  id: string;
  space_id: string;
  candidate_id: string;
  version_kind: string;
  source_version_number: number;
  draft_id: string;
  title: string;
  format: string;
  field_count: number;
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

interface ReleaseRow {
  id: string;
  space_id: string;
  draft_id: string;
  candidate_id: string;
  version_kind: string;
  source_version_number: number;
  field_count: number;
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

interface ReleaseSourceRow {
  preview_request_id: string;
  preview_file_id: string;
  preview_sha256: string;
  candidate_id: string;
  version_kind: string;
  source_version_number: number;
  field_count: number;
  compiled_file_id: string;
  compiled_sha256: string;
  trial_sha256: string;
  draft_id: string;
  space_id: string;
  title: string;
  format: string;
}

interface CandidateFieldRow {
  field_id: string;
  ordinal: number;
  field_key: string;
  field_label: string;
  value_type: string;
  required: number;
  binding_json: string;
  formatter_json: string;
  technical_binding_json: string;
}

interface FileRow {
  id: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
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
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
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

function candidateKind(value: string): TemplateReleaseCandidateKind {
  if (value === "single" || value === "multi") return value;
  throw new Error(`Stored release candidate kind is invalid: ${value}`);
}

function formatValue(value: string): ActiveTemplateReleaseFormat {
  if (value === "docx" || value === "xlsx") return value;
  throw new Error(`Stored template format is invalid: ${value}`);
}

function previewState(value: string): TemplateReleasePreviewState {
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

function mapPreview(row: PreviewRow): TemplateReleasePreviewRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    versionId: row.candidate_id,
    versionKind: candidateKind(row.version_kind),
    sourceVersionNumber: Number(row.source_version_number),
    draftId: row.draft_id,
    title: row.title,
    format: formatValue(row.format),
    fieldCount: Number(row.field_count),
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

function mapRelease(row: ReleaseRow): ActiveTemplateReleaseRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    draftId: row.draft_id,
    versionId: row.candidate_id,
    versionKind: candidateKind(row.version_kind),
    sourceVersionNumber: Number(row.source_version_number),
    fieldCount: Number(row.field_count),
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
      c.kind AS version_kind,
      c.source_version_number,
      c.draft_id,
      d.title,
      c.format,
      c.field_count,
      c.trial_sha256,
      j.state AS worker_state,
      j.attempts AS worker_attempts,
      j.max_attempts AS worker_max_attempts
    FROM template_release_previews p
    JOIN template_release_candidates c ON c.id = p.candidate_id
    JOIN template_drafts d ON d.id = c.draft_id
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

function releaseSelect(): string {
  return `
    SELECT
      r.*,
      c.kind AS version_kind,
      c.source_version_number,
      c.field_count,
      cf.sha256 AS compiled_sha256,
      pf.sha256 AS preview_sha256
    FROM template_releases r
    JOIN template_release_candidates c ON c.id = r.candidate_id
    JOIN files cf ON cf.id = r.compiled_file_id
    JOIN files pf ON pf.id = r.preview_file_id
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
    .prepare(
      "SELECT id, sha256, size_bytes, storage_path FROM files WHERE sha256 = ?"
    )
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

function candidateFields(
  connection: SqliteExecutor,
  candidateId: string
): CandidateFieldRow[] {
  return connection
    .prepare(`
      SELECT
        field_id, ordinal, field_key, field_label, value_type,
        required, binding_json, formatter_json, technical_binding_json
      FROM template_release_candidate_fields
      WHERE candidate_id = ?
      ORDER BY ordinal ASC, field_id ASC
    `)
    .all(candidateId) as unknown as CandidateFieldRow[];
}

export class TemplateReleaseRegistry {
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
    input: RequestTemplateReleasePreviewInput,
    contextInput: MutationContext
  ): {
    request: TemplateReleasePreviewRecord;
    created: boolean;
    retried: boolean;
  } {
    const id = input.id ?? randomUUID();
    const spaceId = requiredText(input.spaceId, "spaceId", 160);
    const versionId = requiredText(input.versionId, "versionId", 160);
    const versionKind = candidateKind(input.versionKind);
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const candidate = connection
        .prepare(`
          SELECT id
          FROM template_release_candidates
          WHERE id = ? AND space_id = ? AND kind = ?
        `)
        .get(versionId, spaceId, versionKind) as { id: string } | undefined;
      if (candidate === undefined) {
        throw new TemplatePreviewNotFoundError(
          `Template release candidate was not found in this space: ${versionId}`
        );
      }

      const existing = connection
        .prepare(`
          SELECT id, state, request_attempt
          FROM template_release_previews
          WHERE space_id = ? AND candidate_id = ?
        `)
        .get(spaceId, versionId) as
        | { id: string; state: string; request_attempt: number }
        | undefined;
      if (existing !== undefined && existing.state !== "failed") {
        const row = previewRow(connection, existing.id, spaceId);
        if (row === undefined) {
          throw new Error(`Preview request was not found: ${existing.id}`);
        }
        return { request: mapPreview(row), created: false, retried: false };
      }

      const requestId = existing?.id ?? id;
      const attempt =
        existing === undefined ? 1 : Number(existing.request_attempt) + 1;
      const queued = this.queue.enqueue(
        {
          jobType: "template.preview",
          payload: toJsonValue({
            previewRequestId: requestId,
            spaceId,
            versionId,
            versionKind,
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
            INSERT INTO template_release_previews(
              id, space_id, candidate_id, worker_job_id, request_attempt,
              state, preview_file_id, preview_sha256, converter_json,
              error_json, requested_by, correlation_id, requested_at,
              completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, ?, ?, NULL, ?)
          `)
          .run(
            requestId,
            spaceId,
            versionId,
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
            UPDATE template_release_previews
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
          eventType: "template.release-preview.requested",
          schemaVersion: 1,
          source: "template-release-registry",
          occurredAt: context.now,
          payload: {
            requestId,
            spaceId,
            versionId,
            versionKind,
            attempt,
            workerJobId: queued.job.id
          },
          dedupeKey: `template.release-preview.requested:${requestId}:attempt:${attempt}`,
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
          objectType: "template_release_candidate",
          objectId: versionId,
          correlationId: context.correlationId,
          details: {
            requestId,
            versionKind,
            attempt,
            workerJobId: queued.job.id
          }
        },
        connection
      );

      const row = previewRow(connection, requestId, spaceId);
      if (row === undefined) {
        throw new Error(`Created preview request was not found: ${requestId}`);
      }
      return {
        request: mapPreview(row),
        created: existing === undefined,
        retried: existing !== undefined
      };
    });
  }

  getPreview(
    spaceIdentity: string,
    requestIdValue: string
  ): TemplateReleasePreviewRecord {
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

  getPreviewForWorker(requestIdValue: string): TemplateReleasePreviewRecord {
    const requestId = requiredText(requestIdValue, "requestId", 160);
    return this.store.execute((connection) => {
      const row = previewRow(connection, requestId);
      if (row === undefined) {
        throw new TemplatePreviewNotFoundError(
          `Template preview was not found: ${requestId}`
        );
      }
      return mapPreview(row);
    });
  }

  async completePreview(
    input: CompleteTemplateReleasePreviewInput,
    contextInput: MutationContext
  ): Promise<TemplateReleasePreviewRecord> {
    const requestId = requiredText(input.requestId, "requestId", 160);
    const context = contextValue(contextInput);
    const pdf = Buffer.from(input.previewBuffer);
    if (pdf.length < 8 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new TemplatePreviewValidationError(
        "LibreOffice did not produce a valid PDF preview"
      );
    }
    if (pdf.length > 128 * 1024 * 1024) {
      throw new TemplatePreviewValidationError(
        "PDF preview exceeds the 128 MB limit"
      );
    }
    const converter = toJsonValue(input.converter);
    const stored = await this.objectStore.putBuffer(pdf);

    return this.store.transaction((connection) => {
      const current = previewRow(connection, requestId);
      if (current === undefined) {
        throw new TemplatePreviewNotFoundError(
          `Template preview was not found: ${requestId}`
        );
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
          UPDATE template_release_previews
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
          eventType: "template.release-preview.ready",
          schemaVersion: 1,
          source: "template-release-registry",
          occurredAt: context.now,
          payload: {
            requestId,
            previewFileId: file.id,
            previewSha256: stored.sha256
          },
          dedupeKey: `template.release-preview.ready:${requestId}:${stored.sha256}`,
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
          objectType: "template_release_preview",
          objectId: requestId,
          correlationId: context.correlationId,
          details: {
            previewFileId: file.id,
            previewSha256: stored.sha256
          }
        },
        connection
      );

      const row = previewRow(connection, requestId);
      if (row === undefined) {
        throw new Error(`Completed preview was not found: ${requestId}`);
      }
      return mapPreview(row);
    });
  }

  failPreview(
    requestIdValue: string,
    errorValue: JsonValue,
    contextInput: MutationContext
  ): TemplateReleasePreviewRecord {
    const requestId = requiredText(requestIdValue, "requestId", 160);
    const error = toJsonValue(errorValue);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = previewRow(connection, requestId);
      if (current === undefined) {
        throw new TemplatePreviewNotFoundError(
          `Template preview was not found: ${requestId}`
        );
      }
      if (current.state === "ready") {
        throw new TemplatePreviewConflictError(
          "Ready preview cannot be replaced with a failure"
        );
      }
      connection
        .prepare(`
          UPDATE template_release_previews
          SET state = 'failed', error_json = ?, completed_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(stringifyJson(error), context.now, context.now, requestId);
      this.outbox.append(
        {
          eventType: "template.release-preview.failed",
          schemaVersion: 1,
          source: "template-release-registry",
          occurredAt: context.now,
          payload: { requestId, error },
          dedupeKey: `template.release-preview.failed:${requestId}:attempt:${current.request_attempt}`,
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
          objectType: "template_release_preview",
          objectId: requestId,
          correlationId: context.correlationId,
          details: { error }
        },
        connection
      );
      const row = previewRow(connection, requestId);
      if (row === undefined) {
        throw new Error(`Failed preview was not found: ${requestId}`);
      }
      return mapPreview(row);
    });
  }

  activateVersion(
    input: ActivateTemplateReleaseInput,
    contextInput: MutationContext
  ): ActiveTemplateReleaseRecord {
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
            c.id AS candidate_id,
            c.kind AS version_kind,
            c.source_version_number,
            c.field_count,
            c.compiled_file_id,
            c.compiled_sha256,
            c.trial_sha256,
            d.id AS draft_id,
            d.space_id,
            d.title,
            d.format
          FROM template_release_previews p
          JOIN template_release_candidates c ON c.id = p.candidate_id
          JOIN template_drafts d ON d.id = c.draft_id
          WHERE p.id = ?
            AND p.space_id = ?
            AND p.state = 'ready'
            AND p.preview_file_id IS NOT NULL
            AND p.preview_sha256 IS NOT NULL
        `)
        .get(previewRequestId, spaceId) as ReleaseSourceRow | undefined;
      if (source === undefined) {
        throw new TemplateActivationNotFoundError(
          `Ready template preview was not found in this space: ${previewRequestId}`
        );
      }

      const existing = connection
        .prepare(
          `${releaseSelect()} WHERE r.draft_id = ? AND r.candidate_id = ?`
        )
        .get(source.draft_id, source.candidate_id) as ReleaseRow | undefined;
      if (existing !== undefined) {
        connection
          .prepare(`
            INSERT INTO template_release_pointers(
              draft_id, space_id, release_id, updated_by,
              correlation_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(draft_id) DO UPDATE SET
              space_id = excluded.space_id,
              release_id = excluded.release_id,
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
        return mapRelease(existing);
      }

      const fields = candidateFields(connection, source.candidate_id);
      if (fields.length !== Number(source.field_count)) {
        throw new TemplatePreviewConflictError(
          `Release candidate ${source.candidate_id} expected ${source.field_count} fields, found ${fields.length}`
        );
      }
      const current = connection
        .prepare(
          "SELECT COALESCE(MAX(version_number), 0) AS value FROM template_releases WHERE draft_id = ?"
        )
        .get(source.draft_id) as { value: number };
      const versionNumber = Number(current.value) + 1;
      const versionKind = candidateKind(source.version_kind);
      const manifest = toJsonValue({
        version: 3,
        draftId: source.draft_id,
        title: source.title,
        format: source.format,
        candidateId: source.candidate_id,
        versionKind,
        sourceVersionNumber: Number(source.source_version_number),
        fieldCount: Number(source.field_count),
        compiledSha256: source.compiled_sha256,
        trialSha256: source.trial_sha256,
        previewSha256: source.preview_sha256,
        fields: fields.map((field) => ({
          id: field.field_id,
          key: field.field_key,
          label: field.field_label,
          valueType: field.value_type,
          required: field.required === 1,
          binding: parseJson(field.binding_json),
          formatter: parseJson(field.formatter_json),
          technicalBinding: parseJson(field.technical_binding_json)
        }))
      });

      connection
        .prepare(`
          INSERT INTO template_releases(
            id, space_id, draft_id, candidate_id, preview_request_id,
            compiled_file_id, preview_file_id, version_number, title,
            format, manifest_json, activated_by, correlation_id, activated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          spaceId,
          source.draft_id,
          source.candidate_id,
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
          INSERT INTO template_release_pointers(
            draft_id, space_id, release_id, updated_by,
            correlation_id, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(draft_id) DO UPDATE SET
            space_id = excluded.space_id,
            release_id = excluded.release_id,
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
          eventType: "template.release.activated",
          schemaVersion: 1,
          source: "template-release-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId,
            draftId: source.draft_id,
            versionId: source.candidate_id,
            versionKind,
            previewRequestId,
            versionNumber,
            fieldCount: Number(source.field_count)
          },
          dedupeKey: `template.release.activated:${id}:v1`,
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
          objectType: "template_release",
          objectId: id,
          correlationId: context.correlationId,
          details: {
            spaceId,
            draftId: source.draft_id,
            versionId: source.candidate_id,
            versionKind,
            previewRequestId,
            versionNumber,
            fieldCount: Number(source.field_count)
          }
        },
        connection
      );

      const row = connection
        .prepare(`${releaseSelect()} WHERE r.id = ? AND r.space_id = ?`)
        .get(id, spaceId) as ReleaseRow | undefined;
      if (row === undefined) {
        throw new Error(`Activated template release was not found: ${id}`);
      }
      return mapRelease(row);
    });
  }

  listActiveTemplates(spaceIdentity: string): ActiveTemplateReleaseRecord[] {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new TemplateActivationNotFoundError(
          `Space was not found: ${identity}`
        );
      }
      const rows = connection
        .prepare(`
          ${releaseSelect()}
          JOIN template_release_pointers pointer
            ON pointer.release_id = r.id
           AND pointer.draft_id = r.draft_id
          WHERE r.space_id = ?
          ORDER BY r.title COLLATE NOCASE, r.activated_at DESC, r.id
        `)
        .all(space.id) as unknown as ReleaseRow[];
      return rows.map(mapRelease);
    });
  }

  getActiveTemplate(
    spaceIdentity: string,
    activeVersionIdValue: string
  ): ActiveTemplateReleaseRecord {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const activeVersionId = requiredText(
      activeVersionIdValue,
      "activeVersionId",
      160
    );
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new TemplateActivationNotFoundError(
          `Space was not found: ${identity}`
        );
      }
      const row = connection
        .prepare(`${releaseSelect()} WHERE r.id = ? AND r.space_id = ?`)
        .get(activeVersionId, space.id) as ReleaseRow | undefined;
      if (row === undefined) {
        throw new TemplateActivationNotFoundError(
          `Active template version was not found in this space: ${activeVersionId}`
        );
      }
      return mapRelease(row);
    });
  }
}
