import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { ContentAddressedObjectStore, type StoredObject } from "./object-store.js";
import { DomainEventOutbox } from "./outbox.js";
import { WorkerQueue, type WorkerJobState } from "./queue.js";

export type DocumentGenerationMode = "one_per_member" | "aggregate";
export type DocumentGenerationState =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed";
export type DocumentGenerationUnitState =
  | "pending"
  | "running"
  | "completed"
  | "failed";
export type DocumentGenerationFormat = "docx" | "xlsx";
export type DocumentGenerationValueType =
  | "string"
  | "text"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "date-time";

export interface CreateDocumentGenerationJobInput {
  id?: string;
  spaceId: string;
  activeReleaseId: string;
  snapshotId: string;
  idempotencyKey?: string | null;
}

export interface DocumentGenerationUnitRecord {
  id: string;
  jobId: string;
  position: number;
  key: string;
  primaryEntityId: string | null;
  state: DocumentGenerationUnitState;
  outputFileId: string | null;
  outputSha256: string | null;
  outputName: string | null;
  error: JsonValue | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface DocumentGenerationJobRecord {
  id: string;
  spaceId: string;
  activeReleaseId: string;
  snapshotId: string;
  targetMode: DocumentGenerationMode;
  format: DocumentGenerationFormat;
  templateTitle: string;
  memberCount: number;
  state: DocumentGenerationState;
  expectedCount: number;
  generatedCount: number;
  failedCount: number;
  workerJobId: string;
  workerJobState: WorkerJobState;
  archiveFileId: string | null;
  archiveSha256: string | null;
  error: JsonValue | null;
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  units: DocumentGenerationUnitRecord[];
}

export interface DocumentGenerationField {
  id: string;
  ordinal: number;
  key: string;
  label: string;
  valueType: DocumentGenerationValueType;
  required: boolean;
  binding: JsonValue;
  technicalBinding: JsonValue;
}

export interface DocumentGenerationMember {
  entityId: string;
  position: number;
  displayName: string;
  entityTypeKey: string;
  properties: Record<string, JsonValue>;
}

export interface DocumentGenerationWork {
  job: DocumentGenerationJobRecord;
  space: { id: string; key: string; name: string };
  template: {
    id: string;
    title: string;
    format: DocumentGenerationFormat;
    compiledSha256: string;
    fields: DocumentGenerationField[];
  };
  members: DocumentGenerationMember[];
}

interface JobRow {
  id: string;
  space_id: string;
  active_release_id: string;
  snapshot_id: string;
  target_mode: string;
  format: string;
  template_title: string;
  member_count: number;
  state: string;
  expected_count: number;
  generated_count: number;
  failed_count: number;
  worker_job_id: string;
  worker_state: string;
  archive_file_id: string | null;
  archive_sha256: string | null;
  error_json: string | null;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface UnitRow {
  id: string;
  job_id: string;
  position: number;
  unit_key: string;
  primary_entity_id: string | null;
  state: string;
  output_file_id: string | null;
  output_sha256: string | null;
  output_name: string | null;
  error_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface SourceRow {
  release_id: string;
  draft_id: string;
  candidate_id: string;
  title: string;
  format: string;
  compiled_sha256: string;
  field_count: number;
  snapshot_id: string;
  target_mode: string;
  member_count: number;
}

interface FieldRow {
  field_id: string;
  ordinal: number;
  field_key: string;
  field_label: string;
  value_type: string;
  required: number;
  binding_json: string;
  technical_binding_json: string;
}

interface MemberRow {
  entity_id: string;
  position: number;
  display_name_snapshot: string;
  entity_type_key_snapshot: string;
}

interface PropertyRow {
  entity_id: string;
  property_key: string;
  cardinality: string;
  value_json: string;
}

interface FileRow {
  id: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
}

export class DocumentGenerationValidationError extends Error {
  override readonly name = "DocumentGenerationValidationError";
}

export class DocumentGenerationNotFoundError extends Error {
  override readonly name = "DocumentGenerationNotFoundError";
}

export class DocumentGenerationConflictError extends Error {
  override readonly name = "DocumentGenerationConflictError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new DocumentGenerationValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DocumentGenerationValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new DocumentGenerationValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function optionalText(
  value: string | null | undefined,
  name: string,
  maximum = 240
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum) {
    throw new DocumentGenerationValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DocumentGenerationValidationError("Invalid mutation timestamp");
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

function generationMode(value: string): DocumentGenerationMode {
  if (value === "one_per_member" || value === "aggregate") return value;
  throw new Error(`Stored document generation mode is invalid: ${value}`);
}

function generationState(value: string): DocumentGenerationState {
  if (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "partial" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error(`Stored document generation state is invalid: ${value}`);
}

function unitState(value: string): DocumentGenerationUnitState {
  if (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error(`Stored document generation unit state is invalid: ${value}`);
}

function formatValue(value: string): DocumentGenerationFormat {
  if (value === "docx" || value === "xlsx") return value;
  throw new Error(`Stored document generation format is invalid: ${value}`);
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
  throw new Error(`Stored worker job state is invalid: ${value}`);
}

function valueType(value: string): DocumentGenerationValueType {
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
  throw new Error(`Stored document field value type is invalid: ${value}`);
}

function jobSelect(): string {
  return `
    SELECT
      j.*,
      r.title AS template_title,
      r.format,
      s.member_count,
      w.state AS worker_state
    FROM document_generation_jobs j
    JOIN template_releases r ON r.id = j.active_release_id
    JOIN audience_snapshots s ON s.id = j.snapshot_id
    JOIN worker_jobs w ON w.id = j.worker_job_id
  `;
}

function unitRows(
  connection: SqliteExecutor,
  jobId: string
): DocumentGenerationUnitRecord[] {
  const rows = connection
    .prepare(`
      SELECT *
      FROM document_generation_units
      WHERE job_id = ?
      ORDER BY position ASC, id ASC
    `)
    .all(jobId) as unknown as UnitRow[];
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    position: Number(row.position),
    key: row.unit_key,
    primaryEntityId: row.primary_entity_id,
    state: unitState(row.state),
    outputFileId: row.output_file_id,
    outputSha256: row.output_sha256,
    outputName: row.output_name,
    error: row.error_json === null ? null : parseJson(row.error_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  }));
}

function mapJob(
  connection: SqliteExecutor,
  row: JobRow
): DocumentGenerationJobRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    activeReleaseId: row.active_release_id,
    snapshotId: row.snapshot_id,
    targetMode: generationMode(row.target_mode),
    format: formatValue(row.format),
    templateTitle: row.template_title,
    memberCount: Number(row.member_count),
    state: generationState(row.state),
    expectedCount: Number(row.expected_count),
    generatedCount: Number(row.generated_count),
    failedCount: Number(row.failed_count),
    workerJobId: row.worker_job_id,
    workerJobState: workerState(row.worker_state),
    archiveFileId: row.archive_file_id,
    archiveSha256: row.archive_sha256,
    error: row.error_json === null ? null : parseJson(row.error_json),
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
    units: unitRows(connection, row.id)
  };
}

function jobRow(
  connection: SqliteExecutor,
  jobId: string,
  spaceId?: string
): JobRow | undefined {
  return connection
    .prepare(
      `${jobSelect()} WHERE j.id = ?${spaceId === undefined ? "" : " AND j.space_id = ?"}`
    )
    .get(...(spaceId === undefined ? [jobId] : [jobId, spaceId])) as
    | JobRow
    | undefined;
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
      throw new DocumentGenerationConflictError(
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

function safeFileName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 140);
  return normalized.length === 0 ? fallback : normalized;
}

export class DocumentGenerationRegistry {
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

  createJob(
    input: CreateDocumentGenerationJobInput,
    contextInput: MutationContext
  ): { job: DocumentGenerationJobRecord; created: boolean } {
    const id = input.id ?? randomUUID();
    const spaceIdentity = requiredText(input.spaceId, "spaceId", 160);
    const activeReleaseId = requiredText(
      input.activeReleaseId,
      "activeReleaseId",
      160
    );
    const snapshotId = requiredText(input.snapshotId, "snapshotId", 160);
    const idempotencyKey = optionalText(
      input.idempotencyKey,
      "idempotencyKey",
      240
    );
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(spaceIdentity, spaceIdentity.toLowerCase()) as
        | { id: string }
        | undefined;
      if (space === undefined) {
        throw new DocumentGenerationNotFoundError(
          `Space was not found: ${spaceIdentity}`
        );
      }
      if (idempotencyKey !== null) {
        const existing = connection
          .prepare(
            `${jobSelect()} WHERE j.space_id = ? AND j.idempotency_key = ?`
          )
          .get(space.id, idempotencyKey) as JobRow | undefined;
        if (existing !== undefined) {
          return { job: mapJob(connection, existing), created: false };
        }
      }

      const source = connection
        .prepare(`
          SELECT
            r.id AS release_id,
            r.draft_id,
            r.candidate_id,
            r.title,
            r.format,
            c.compiled_sha256,
            c.field_count,
            s.id AS snapshot_id,
            s.target_mode,
            s.member_count
          FROM template_releases r
          JOIN template_release_candidates c ON c.id = r.candidate_id
          JOIN audience_snapshots s ON s.id = ? AND s.space_id = r.space_id
          WHERE r.id = ? AND r.space_id = ?
        `)
        .get(snapshotId, activeReleaseId, space.id) as SourceRow | undefined;
      if (source === undefined) {
        throw new DocumentGenerationNotFoundError(
          "Active template or audience snapshot was not found in this space"
        );
      }
      const mode = generationMode(source.target_mode);
      const memberCount = Number(source.member_count);
      if (memberCount < 1 || memberCount > 1_000) {
        throw new DocumentGenerationValidationError(
          "Audience snapshot must contain from 1 to 1000 members"
        );
      }
      const expectedCount = mode === "aggregate" ? 1 : memberCount;
      const queued = this.queue.enqueue(
        {
          jobType: "document.generate",
          payload: toJsonValue({ documentJobId: id, spaceId: space.id }),
          priority: 60,
          maxAttempts: 1,
          idempotencyKey: `document.generate:${id}`,
          now: context.now
        },
        connection
      );

      connection
        .prepare(`
          INSERT INTO document_generation_jobs(
            id, space_id, active_release_id, snapshot_id, target_mode,
            state, expected_count, generated_count, failed_count,
            worker_job_id, idempotency_key, archive_file_id, archive_sha256,
            error_json, created_by, correlation_id, created_at,
            started_at, completed_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, 'pending', ?, 0, 0,
            ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, NULL, ?
          )
        `)
        .run(
          id,
          space.id,
          activeReleaseId,
          snapshotId,
          mode,
          expectedCount,
          queued.job.id,
          idempotencyKey,
          context.actorId,
          context.correlationId,
          context.now,
          context.now
        );

      const members = connection
        .prepare(`
          SELECT entity_id, position, display_name_snapshot, entity_type_key_snapshot
          FROM audience_snapshot_members
          WHERE snapshot_id = ?
          ORDER BY position ASC
        `)
        .all(snapshotId) as unknown as MemberRow[];
      const insertUnit = connection.prepare(`
        INSERT INTO document_generation_units(
          id, job_id, position, unit_key, primary_entity_id,
          state, output_file_id, output_sha256, output_name,
          error_json, started_at, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, ?)
      `);
      if (mode === "aggregate") {
        insertUnit.run(
          randomUUID(),
          id,
          0,
          `audience:${snapshotId}:aggregate`,
          null,
          context.now
        );
      } else {
        members.forEach((member, position) => {
          insertUnit.run(
            randomUUID(),
            id,
            position,
            `audience:${snapshotId}:entity:${member.entity_id}`,
            member.entity_id,
            context.now
          );
        });
      }

      this.outbox.append(
        {
          eventType: "document.generation.requested",
          schemaVersion: 1,
          source: "document-generation-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId: space.id,
            activeReleaseId,
            snapshotId,
            targetMode: mode,
            memberCount,
            expectedCount,
            workerJobId: queued.job.id
          },
          dedupeKey: `document.generation.requested:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "request_generation",
          objectType: "document_generation_job",
          objectId: id,
          correlationId: context.correlationId,
          details: {
            spaceId: space.id,
            activeReleaseId,
            snapshotId,
            targetMode: mode,
            memberCount,
            expectedCount
          }
        },
        connection
      );

      const row = jobRow(connection, id, space.id);
      if (row === undefined) {
        throw new Error(`Created document generation job was not found: ${id}`);
      }
      return { job: mapJob(connection, row), created: true };
    });
  }

  getJob(spaceIdentity: string, jobIdValue: string): DocumentGenerationJobRecord {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const jobId = requiredText(jobIdValue, "jobId", 160);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new DocumentGenerationNotFoundError(`Space was not found: ${identity}`);
      }
      const row = jobRow(connection, jobId, space.id);
      if (row === undefined) {
        throw new DocumentGenerationNotFoundError(
          `Document generation job was not found in this space: ${jobId}`
        );
      }
      return mapJob(connection, row);
    });
  }

  listJobs(spaceIdentity: string, limitValue = 50): DocumentGenerationJobRecord[] {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 200) {
      throw new DocumentGenerationValidationError(
        "limit must be an integer in range 1..200"
      );
    }
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new DocumentGenerationNotFoundError(`Space was not found: ${identity}`);
      }
      const rows = connection
        .prepare(`
          ${jobSelect()}
          WHERE j.space_id = ?
          ORDER BY j.created_at DESC, j.id DESC
          LIMIT ?
        `)
        .all(space.id, limitValue) as unknown as JobRow[];
      return rows.map((row) => mapJob(connection, row));
    });
  }

  getWorkForWorker(jobIdValue: string): DocumentGenerationWork {
    const jobId = requiredText(jobIdValue, "jobId", 160);
    return this.store.execute((connection) => {
      const row = jobRow(connection, jobId);
      if (row === undefined) {
        throw new DocumentGenerationNotFoundError(
          `Document generation job was not found: ${jobId}`
        );
      }
      const job = mapJob(connection, row);
      const source = connection
        .prepare(`
          SELECT
            r.id AS release_id,
            r.draft_id,
            r.candidate_id,
            r.title,
            r.format,
            c.compiled_sha256,
            c.field_count,
            s.id AS snapshot_id,
            s.target_mode,
            s.member_count
          FROM template_releases r
          JOIN template_release_candidates c ON c.id = r.candidate_id
          JOIN audience_snapshots s ON s.id = ?
          WHERE r.id = ? AND r.space_id = ? AND s.space_id = ?
        `)
        .get(job.snapshotId, job.activeReleaseId, job.spaceId, job.spaceId) as
        | SourceRow
        | undefined;
      if (source === undefined) {
        throw new DocumentGenerationConflictError(
          "Document generation source no longer matches the job"
        );
      }
      const fieldRows = connection
        .prepare(`
          SELECT
            field_id, ordinal, field_key, field_label, value_type,
            required, binding_json, technical_binding_json
          FROM template_release_candidate_fields
          WHERE candidate_id = ?
          ORDER BY ordinal ASC, field_id ASC
        `)
        .all(source.candidate_id) as unknown as FieldRow[];
      if (fieldRows.length !== Number(source.field_count)) {
        throw new DocumentGenerationConflictError(
          "Active template field manifest is incomplete"
        );
      }
      const memberRows = connection
        .prepare(`
          SELECT entity_id, position, display_name_snapshot, entity_type_key_snapshot
          FROM audience_snapshot_members
          WHERE snapshot_id = ?
          ORDER BY position ASC
        `)
        .all(job.snapshotId) as unknown as MemberRow[];
      const propertyMap = new Map<string, Record<string, JsonValue>>();
      const ids = memberRows.map((member) => member.entity_id);
      for (let offset = 0; offset < ids.length; offset += 200) {
        const chunk = ids.slice(offset, offset + 200);
        if (chunk.length === 0) continue;
        const placeholders = chunk.map(() => "?").join(", ");
        const properties = connection
          .prepare(`
            SELECT
              v.entity_id,
              p.key AS property_key,
              p.cardinality,
              v.value_json
            FROM entity_property_values v
            JOIN property_definitions p ON p.id = v.property_definition_id
            JOIN (
              SELECT entity_id, property_definition_id, MAX(version) AS max_version
              FROM entity_property_values
              WHERE entity_id IN (${placeholders})
              GROUP BY entity_id, property_definition_id
            ) latest
              ON latest.entity_id = v.entity_id
             AND latest.property_definition_id = v.property_definition_id
             AND latest.max_version = v.version
            ORDER BY v.entity_id, p.key
          `)
          .all(...chunk) as unknown as PropertyRow[];
        for (const property of properties) {
          const values = propertyMap.get(property.entity_id) ?? {};
          values[property.property_key] = parseJson(property.value_json);
          propertyMap.set(property.entity_id, values);
        }
      }
      const space = connection
        .prepare("SELECT id, key, name FROM spaces WHERE id = ?")
        .get(job.spaceId) as { id: string; key: string; name: string } | undefined;
      if (space === undefined) {
        throw new DocumentGenerationConflictError("Job space no longer exists");
      }
      return {
        job,
        space,
        template: {
          id: source.release_id,
          title: source.title,
          format: formatValue(source.format),
          compiledSha256: source.compiled_sha256,
          fields: fieldRows.map((field) => ({
            id: field.field_id,
            ordinal: Number(field.ordinal),
            key: field.field_key,
            label: field.field_label,
            valueType: valueType(field.value_type),
            required: field.required === 1,
            binding: parseJson(field.binding_json),
            technicalBinding: parseJson(field.technical_binding_json)
          }))
        },
        members: memberRows.map((member) => ({
          entityId: member.entity_id,
          position: Number(member.position),
          displayName: member.display_name_snapshot,
          entityTypeKey: member.entity_type_key_snapshot,
          properties: propertyMap.get(member.entity_id) ?? {}
        }))
      };
    });
  }

  startJob(jobIdValue: string, contextInput: MutationContext): DocumentGenerationJobRecord {
    const jobId = requiredText(jobIdValue, "jobId", 160);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = jobRow(connection, jobId);
      if (current === undefined) {
        throw new DocumentGenerationNotFoundError(
          `Document generation job was not found: ${jobId}`
        );
      }
      if (current.state === "completed" || current.state === "partial") {
        return mapJob(connection, current);
      }
      connection
        .prepare(`
          UPDATE document_generation_jobs
          SET state = 'running', started_at = COALESCE(started_at, ?),
              error_json = NULL, updated_at = ?
          WHERE id = ? AND state IN ('pending', 'running')
        `)
        .run(context.now, context.now, jobId);
      const row = jobRow(connection, jobId);
      if (row === undefined) throw new Error(`Started job was not found: ${jobId}`);
      return mapJob(connection, row);
    });
  }

  startUnit(unitIdValue: string, contextInput: MutationContext): void {
    const unitId = requiredText(unitIdValue, "unitId", 160);
    const context = contextValue(contextInput);
    this.store.transaction((connection) => {
      const changed = connection
        .prepare(`
          UPDATE document_generation_units
          SET state = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
          WHERE id = ? AND state = 'pending'
        `)
        .run(context.now, context.now, unitId);
      if (Number(changed.changes) === 0) {
        const existing = connection
          .prepare("SELECT state FROM document_generation_units WHERE id = ?")
          .get(unitId) as { state: string } | undefined;
        if (existing === undefined) {
          throw new DocumentGenerationNotFoundError(
            `Document generation unit was not found: ${unitId}`
          );
        }
      }
    });
  }

  async completeUnit(
    unitIdValue: string,
    output: Uint8Array,
    outputNameValue: string,
    format: DocumentGenerationFormat,
    contextInput: MutationContext
  ): Promise<void> {
    const unitId = requiredText(unitIdValue, "unitId", 160);
    const outputName = safeFileName(outputNameValue, `документ-${unitId}.${format}`);
    const content = Buffer.from(output);
    if (content.length === 0) {
      throw new DocumentGenerationValidationError("Generated document must not be empty");
    }
    const context = contextValue(contextInput);
    const stored = await this.objectStore.putBuffer(content);
    this.store.transaction((connection) => {
      const unit = connection
        .prepare(`
          SELECT u.id, u.job_id, u.state, j.space_id
          FROM document_generation_units u
          JOIN document_generation_jobs j ON j.id = u.job_id
          WHERE u.id = ?
        `)
        .get(unitId) as
        | { id: string; job_id: string; state: string; space_id: string }
        | undefined;
      if (unit === undefined) {
        throw new DocumentGenerationNotFoundError(
          `Document generation unit was not found: ${unitId}`
        );
      }
      if (unit.state === "completed") return;
      const mediaType =
        format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const file = ensureFile(
        connection,
        stored,
        outputName,
        mediaType,
        context.now,
        context.actorId
      );
      connection
        .prepare(`
          UPDATE document_generation_units
          SET state = 'completed', output_file_id = ?, output_sha256 = ?,
              output_name = ?, error_json = NULL, completed_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          file.id,
          stored.sha256,
          outputName,
          context.now,
          context.now,
          unitId
        );
    });
  }

  failUnit(
    unitIdValue: string,
    errorValue: JsonValue,
    contextInput: MutationContext
  ): void {
    const unitId = requiredText(unitIdValue, "unitId", 160);
    const error = toJsonValue(errorValue);
    const context = contextValue(contextInput);
    this.store.transaction((connection) => {
      const changed = connection
        .prepare(`
          UPDATE document_generation_units
          SET state = 'failed', error_json = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND state <> 'completed'
        `)
        .run(stringifyJson(error), context.now, context.now, unitId);
      if (Number(changed.changes) === 0) {
        const existing = connection
          .prepare("SELECT id FROM document_generation_units WHERE id = ?")
          .get(unitId);
        if (existing === undefined) {
          throw new DocumentGenerationNotFoundError(
            `Document generation unit was not found: ${unitId}`
          );
        }
      }
    });
  }

  async finishJob(
    jobIdValue: string,
    archive: Uint8Array | null,
    contextInput: MutationContext
  ): Promise<DocumentGenerationJobRecord> {
    const jobId = requiredText(jobIdValue, "jobId", 160);
    const context = contextValue(contextInput);
    const archiveBuffer = archive === null ? null : Buffer.from(archive);
    const storedArchive =
      archiveBuffer === null ? null : await this.objectStore.putBuffer(archiveBuffer);
    return this.store.transaction((connection) => {
      const current = jobRow(connection, jobId);
      if (current === undefined) {
        throw new DocumentGenerationNotFoundError(
          `Document generation job was not found: ${jobId}`
        );
      }
      const counts = connection
        .prepare(`
          SELECT
            SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) AS generated,
            SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
            COUNT(*) AS total
          FROM document_generation_units
          WHERE job_id = ?
        `)
        .get(jobId) as { generated: number | null; failed: number | null; total: number };
      const generated = Number(counts.generated ?? 0);
      const failed = Number(counts.failed ?? 0);
      const total = Number(counts.total);
      if (generated + failed !== total) {
        throw new DocumentGenerationConflictError(
          "Document generation cannot finish while units are pending"
        );
      }
      const state: DocumentGenerationState =
        generated === 0 ? "failed" : failed > 0 ? "partial" : "completed";
      let archiveFileId: string | null = null;
      let archiveSha256: string | null = null;
      if (storedArchive !== null) {
        const file = ensureFile(
          connection,
          storedArchive,
          `комплект-${safeFileName(current.template_title, "документы")}.zip`,
          "application/zip",
          context.now,
          context.actorId
        );
        archiveFileId = file.id;
        archiveSha256 = storedArchive.sha256;
      }
      const error =
        failed === 0
          ? null
          : toJsonValue({
              code: "some_documents_failed",
              message:
                generated === 0
                  ? "Не удалось сформировать ни одного документа."
                  : `Сформировано документов: ${generated}; с ошибкой: ${failed}.`
            });
      connection
        .prepare(`
          UPDATE document_generation_jobs
          SET state = ?, generated_count = ?, failed_count = ?,
              archive_file_id = ?, archive_sha256 = ?, error_json = ?,
              completed_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          state,
          generated,
          failed,
          archiveFileId,
          archiveSha256,
          error === null ? null : stringifyJson(error),
          context.now,
          context.now,
          jobId
        );
      this.outbox.append(
        {
          eventType: "document.generation.finished",
          schemaVersion: 1,
          source: "document-generation-registry",
          occurredAt: context.now,
          payload: {
            id: jobId,
            state,
            generatedCount: generated,
            failedCount: failed,
            archiveSha256
          },
          dedupeKey: `document.generation.finished:${jobId}:${state}`,
          now: context.now
        },
        connection
      );
      const row = jobRow(connection, jobId);
      if (row === undefined) throw new Error(`Finished job was not found: ${jobId}`);
      return mapJob(connection, row);
    });
  }

  failJob(
    jobIdValue: string,
    errorValue: JsonValue,
    contextInput: MutationContext
  ): DocumentGenerationJobRecord {
    const jobId = requiredText(jobIdValue, "jobId", 160);
    const error = toJsonValue(errorValue);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = jobRow(connection, jobId);
      if (current === undefined) {
        throw new DocumentGenerationNotFoundError(
          `Document generation job was not found: ${jobId}`
        );
      }
      connection
        .prepare(`
          UPDATE document_generation_jobs
          SET state = 'failed', error_json = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND state NOT IN ('completed', 'partial')
        `)
        .run(stringifyJson(error), context.now, context.now, jobId);
      const row = jobRow(connection, jobId);
      if (row === undefined) throw new Error(`Failed job was not found: ${jobId}`);
      return mapJob(connection, row);
    });
  }
}
