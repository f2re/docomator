import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import type {
  DocumentGenerationFormat,
  DocumentGenerationMode
} from "./document-generation.js";
import type { MutationContext } from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";

export type DocumentResultState = "new" | "viewed" | "collected" | "deleted";
export type DocumentResultOrigin = "manual" | "schedule";

export interface DocumentResultRecord {
  id: string;
  documentJobId: string;
  state: DocumentResultState;
  origin: DocumentResultOrigin;
  scheduleRunId: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
  schedulePeriodKey: string | null;
  spaceId: string;
  spaceName: string;
  templateTitle: string;
  format: DocumentGenerationFormat;
  targetMode: DocumentGenerationMode;
  memberCount: number;
  generatedCount: number;
  failedCount: number;
  archiveSha256: string | null;
  singleOutputName: string | null;
  singleOutputSha256: string | null;
  availableAt: string;
  viewedAt: string | null;
  collectedAt: string | null;
  deletedAt: string | null;
  updatedAt: string;
}

export interface DocumentResultSummary {
  newCount: number;
  viewedCount: number;
  collectedCount: number;
  availableCount: number;
  automaticNewCount: number;
  latestAvailableAt: string | null;
}

export interface ListDocumentResultsOptions {
  state?: "new" | "viewed" | "collected" | "available" | "all";
  origin?: DocumentResultOrigin;
  limit?: number;
}

export interface DocumentResultDownloadDetails {
  kind: "archive" | "single" | "unit";
  unitId?: string;
}

interface ResultRow {
  id: string;
  document_job_id: string;
  result_state: string;
  origin: string;
  schedule_run_id: string | null;
  schedule_id: string | null;
  schedule_name: string | null;
  period_key: string | null;
  space_id: string;
  space_name: string;
  template_title: string;
  format: string;
  target_mode: string;
  member_count: number;
  generated_count: number;
  failed_count: number;
  archive_sha256: string | null;
  single_output_name: string | null;
  single_output_sha256: string | null;
  available_at: string;
  viewed_at: string | null;
  collected_at: string | null;
  deleted_at: string | null;
  updated_at: string;
}

export class DocumentResultValidationError extends Error {
  override readonly name = "DocumentResultValidationError";
}
export class DocumentResultNotFoundError extends Error {
  override readonly name = "DocumentResultNotFoundError";
}
export class DocumentResultConflictError extends Error {
  override readonly name = "DocumentResultConflictError";
}

function requiredText(value: string, name: string, maximum = 160): string {
  if (typeof value !== "string") {
    throw new DocumentResultValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new DocumentResultValidationError(`${name} is invalid`);
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DocumentResultValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function contextValue(context: MutationContext) {
  return {
    correlationId: requiredText(context.correlationId, "correlationId"),
    actorType: requiredText(context.actorType, "actorType", 80),
    actorId:
      context.actorId === undefined || context.actorId === null
        ? null
        : requiredText(context.actorId, "actorId"),
    now: timestamp(context.now)
  };
}

function stateValue(value: string): DocumentResultState {
  if (["new", "viewed", "collected", "deleted"].includes(value)) {
    return value as DocumentResultState;
  }
  throw new Error(`Stored document result state is invalid: ${value}`);
}

function originValue(value: string): DocumentResultOrigin {
  if (value === "manual" || value === "schedule") return value;
  throw new Error(`Stored document result origin is invalid: ${value}`);
}

function formatValue(value: string): DocumentGenerationFormat {
  if (value === "docx" || value === "xlsx") return value;
  throw new Error(`Stored document result format is invalid: ${value}`);
}

function modeValue(value: string): DocumentGenerationMode {
  if (value === "one_per_member" || value === "aggregate") return value;
  throw new Error(`Stored document result mode is invalid: ${value}`);
}

function selectResults(): string {
  return `
    SELECT
      ri.id,
      ri.document_job_id,
      ri.state AS result_state,
      ri.origin,
      ri.schedule_run_id,
      sr.schedule_id,
      ds.name AS schedule_name,
      sr.period_key,
      j.space_id,
      sp.name AS space_name,
      r.title AS template_title,
      r.format,
      j.target_mode,
      snap.member_count,
      j.generated_count,
      j.failed_count,
      j.archive_sha256,
      (
        SELECT u.output_name
        FROM document_generation_units u
        WHERE u.job_id = j.id
          AND u.state = 'completed'
          AND u.output_sha256 IS NOT NULL
        ORDER BY u.position, u.id
        LIMIT 1
      ) AS single_output_name,
      (
        SELECT u.output_sha256
        FROM document_generation_units u
        WHERE u.job_id = j.id
          AND u.state = 'completed'
          AND u.output_sha256 IS NOT NULL
        ORDER BY u.position, u.id
        LIMIT 1
      ) AS single_output_sha256,
      ri.available_at,
      ri.viewed_at,
      ri.collected_at,
      ri.deleted_at,
      ri.updated_at
    FROM document_result_items ri
    JOIN document_generation_jobs j ON j.id = ri.document_job_id
    JOIN template_releases r ON r.id = j.active_release_id
    JOIN audience_snapshots snap ON snap.id = j.snapshot_id
    JOIN spaces sp ON sp.id = j.space_id
    LEFT JOIN document_schedule_runs sr ON sr.id = ri.schedule_run_id
    LEFT JOIN document_schedules ds ON ds.id = sr.schedule_id
  `;
}

function mapResult(row: ResultRow): DocumentResultRecord {
  return {
    id: row.id,
    documentJobId: row.document_job_id,
    state: stateValue(row.result_state),
    origin: originValue(row.origin),
    scheduleRunId: row.schedule_run_id,
    scheduleId: row.schedule_id,
    scheduleName: row.schedule_name,
    schedulePeriodKey: row.period_key,
    spaceId: row.space_id,
    spaceName: row.space_name,
    templateTitle: row.template_title,
    format: formatValue(row.format),
    targetMode: modeValue(row.target_mode),
    memberCount: Number(row.member_count),
    generatedCount: Number(row.generated_count),
    failedCount: Number(row.failed_count),
    archiveSha256: row.archive_sha256,
    singleOutputName: row.single_output_name,
    singleOutputSha256: row.single_output_sha256,
    availableAt: row.available_at,
    viewedAt: row.viewed_at,
    collectedAt: row.collected_at,
    deletedAt: row.deleted_at,
    updatedAt: row.updated_at
  };
}

function resultRow(
  connection: SqliteExecutor,
  resultId: string,
  includeDeleted = false
): ResultRow | undefined {
  return connection
    .prepare(
      `${selectResults()} WHERE ri.id = ?${includeDeleted ? "" : " AND ri.state <> 'deleted'"}`
    )
    .get(resultId) as ResultRow | undefined;
}

function resultRowsByDocumentJobs(
  connection: SqliteExecutor,
  spaceIdentity: string,
  documentJobIds: string[]
): ResultRow[] {
  if (documentJobIds.length === 0) return [];
  const placeholders = documentJobIds.map(() => "?").join(", ");
  return connection
    .prepare(`
      ${selectResults()}
      WHERE (j.space_id = ? OR sp.key = ?)
        AND ri.document_job_id IN (${placeholders})
        AND ri.state <> 'deleted'
    `)
    .all(
      spaceIdentity,
      spaceIdentity.toLowerCase(),
      ...documentJobIds
    ) as unknown as ResultRow[];
}

function normalizedLimit(value: number | undefined): number {
  const limit = value ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new DocumentResultValidationError("limit must be an integer in range 1..500");
  }
  return limit;
}

function normalizedFilter(
  value: ListDocumentResultsOptions["state"]
): NonNullable<ListDocumentResultsOptions["state"]> {
  const filter = value ?? "available";
  if (["new", "viewed", "collected", "available", "all"].includes(filter)) {
    return filter;
  }
  throw new DocumentResultValidationError("Unsupported document result state filter");
}

export class DocumentResultRegistry {
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;

  constructor(
    private readonly store: SqliteStore,
    options: { outbox?: DomainEventOutbox; audit?: AuditRepository } = {}
  ) {
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
  }

  summary(): DocumentResultSummary {
    return this.store.execute((connection) => {
      const row = connection
        .prepare(`
          SELECT
            SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END) AS new_count,
            SUM(CASE WHEN state = 'viewed' THEN 1 ELSE 0 END) AS viewed_count,
            SUM(CASE WHEN state = 'collected' THEN 1 ELSE 0 END) AS collected_count,
            SUM(CASE WHEN state <> 'deleted' THEN 1 ELSE 0 END) AS available_count,
            SUM(CASE WHEN state = 'new' AND origin = 'schedule' THEN 1 ELSE 0 END) AS automatic_new_count,
            MAX(CASE WHEN state <> 'deleted' THEN available_at END) AS latest_available_at
          FROM document_result_items
        `)
        .get() as {
        new_count: number | null;
        viewed_count: number | null;
        collected_count: number | null;
        available_count: number | null;
        automatic_new_count: number | null;
        latest_available_at: string | null;
      };
      return {
        newCount: Number(row.new_count ?? 0),
        viewedCount: Number(row.viewed_count ?? 0),
        collectedCount: Number(row.collected_count ?? 0),
        availableCount: Number(row.available_count ?? 0),
        automaticNewCount: Number(row.automatic_new_count ?? 0),
        latestAvailableAt: row.latest_available_at
      };
    });
  }

  list(options: ListDocumentResultsOptions = {}): DocumentResultRecord[] {
    const filter = normalizedFilter(options.state);
    const origin = options.origin === undefined ? null : originValue(options.origin);
    const limit = normalizedLimit(options.limit);
    const stateClause =
      filter === "all"
        ? "ri.state <> 'deleted'"
        : filter === "available"
          ? "ri.state IN ('new', 'viewed')"
          : "ri.state = ?";
    const parameters: Array<string | number | null> = [];
    if (filter !== "all" && filter !== "available") parameters.push(filter);
    parameters.push(origin, origin, limit);
    return this.store.execute((connection) => {
      const rows = connection
        .prepare(`
          ${selectResults()}
          WHERE ${stateClause}
            AND (? IS NULL OR ri.origin = ?)
          ORDER BY CASE ri.state WHEN 'new' THEN 0 WHEN 'viewed' THEN 1 ELSE 2 END,
                   ri.available_at DESC,
                   ri.id DESC
          LIMIT ?
        `)
        .all(...parameters) as unknown as ResultRow[];
      return rows.map(mapResult);
    });
  }

  get(resultIdValue: string): DocumentResultRecord {
    const resultId = requiredText(resultIdValue, "resultId");
    return this.store.execute((connection) => {
      const row = resultRow(connection, resultId);
      if (row === undefined) {
        throw new DocumentResultNotFoundError(`Document result was not found: ${resultId}`);
      }
      return mapResult(row);
    });
  }

  findByDocumentJobs(
    spaceIdValue: string,
    documentJobIdValues: string[]
  ): Map<string, DocumentResultRecord> {
    const spaceIdentity = requiredText(spaceIdValue, "spaceId");
    if (documentJobIdValues.length > 500) {
      throw new DocumentResultValidationError(
        "documentJobIds must not contain more than 500 values"
      );
    }
    const documentJobIds = [
      ...new Set(
        documentJobIdValues.map((value) => requiredText(value, "documentJobId"))
      )
    ];
    return this.store.execute((connection) => {
      const rows = resultRowsByDocumentJobs(
        connection,
        spaceIdentity,
        documentJobIds
      );
      return new Map(
        rows.map((row) => {
          const result = mapResult(row);
          return [result.documentJobId, result] as const;
        })
      );
    });
  }

  findByDocumentJob(
    spaceIdValue: string,
    documentJobIdValue: string
  ): DocumentResultRecord | null {
    const documentJobId = requiredText(documentJobIdValue, "documentJobId");
    return this.findByDocumentJobs(spaceIdValue, [documentJobId]).get(documentJobId) ?? null;
  }

  markViewed(resultIdValue: string, contextInput: MutationContext): DocumentResultRecord {
    const resultId = requiredText(resultIdValue, "resultId");
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = resultRow(connection, resultId);
      if (current === undefined) {
        throw new DocumentResultNotFoundError(`Document result was not found: ${resultId}`);
      }
      if (current.result_state === "new") {
        connection
          .prepare(`
            UPDATE document_result_items
            SET state = 'viewed', viewed_at = ?, updated_at = ?
            WHERE id = ? AND state = 'new'
          `)
          .run(context.now, context.now, resultId);
      }
      const row = resultRow(connection, resultId);
      if (row === undefined) throw new Error(`Viewed result was not found: ${resultId}`);
      return mapResult(row);
    });
  }

  markAllViewed(contextInput: MutationContext): number {
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const changed = connection
        .prepare(`
          UPDATE document_result_items
          SET state = 'viewed', viewed_at = ?, updated_at = ?
          WHERE state = 'new'
        `)
        .run(context.now, context.now);
      const count = Number(changed.changes);
      if (count > 0) {
        this.audit.record(
          {
            occurredAt: context.now,
            actorType: context.actorType,
            actorId: context.actorId,
            action: "mark_all_viewed",
            objectType: "document_result_inbox",
            objectId: "shared",
            correlationId: context.correlationId,
            details: { count }
          },
          connection
        );
      }
      return count;
    });
  }

  markCollected(
    resultIdValue: string,
    contextInput: MutationContext,
    downloadDetails: DocumentResultDownloadDetails
  ): DocumentResultRecord {
    const resultId = requiredText(resultIdValue, "resultId");
    const context = contextValue(contextInput);
    const kind = downloadDetails.kind;
    if (!["archive", "single", "unit"].includes(kind)) {
      throw new DocumentResultValidationError("Unsupported document result download kind");
    }
    const unitId =
      downloadDetails.unitId === undefined
        ? null
        : requiredText(downloadDetails.unitId, "unitId");
    if ((kind === "unit") !== (unitId !== null)) {
      throw new DocumentResultValidationError(
        "unitId must be provided only for a unit download"
      );
    }
    return this.store.transaction((connection) => {
      const current = resultRow(connection, resultId);
      if (current === undefined) {
        throw new DocumentResultNotFoundError(`Document result was not found: ${resultId}`);
      }
      if (current.archive_sha256 === null && current.single_output_sha256 === null) {
        throw new DocumentResultConflictError(
          "Document result no longer contains a downloadable file"
        );
      }
      if (kind === "archive" && current.archive_sha256 === null) {
        throw new DocumentResultConflictError(
          "Document result does not contain a downloadable archive"
        );
      }
      if (kind === "single" && current.archive_sha256 !== null) {
        throw new DocumentResultConflictError(
          "Document result must be downloaded as an archive"
        );
      }
      if (unitId !== null) {
        const unit = connection
          .prepare(`
            SELECT id
            FROM document_generation_units
            WHERE id = ?
              AND job_id = ?
              AND state = 'completed'
              AND output_sha256 IS NOT NULL
          `)
          .get(unitId, current.document_job_id) as { id: string } | undefined;
        if (unit === undefined) {
          throw new DocumentResultConflictError(
            "Document generation unit is not downloadable"
          );
        }
      }
      connection
        .prepare(`
          UPDATE document_result_items
          SET state = 'collected',
              viewed_at = COALESCE(viewed_at, ?),
              collected_at = COALESCE(collected_at, ?),
              updated_at = ?
          WHERE id = ? AND state <> 'deleted'
        `)
        .run(context.now, context.now, context.now, resultId);
      this.outbox.append(
        {
          eventType: "document.result.collected",
          schemaVersion: 1,
          source: "document-result-registry",
          occurredAt: context.now,
          payload: { id: resultId, documentJobId: current.document_job_id },
          dedupeKey: `document.result.collected:${resultId}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "download",
          objectType: "document_result",
          objectId: resultId,
          correlationId: context.correlationId,
          details: {
            documentJobId: current.document_job_id,
            stateBefore: current.result_state,
            kind,
            ...(unitId === null ? {} : { unitId })
          }
        },
        connection
      );
      const row = resultRow(connection, resultId);
      if (row === undefined) throw new Error(`Collected result was not found: ${resultId}`);
      return mapResult(row);
    });
  }

  delete(resultIdValue: string, contextInput: MutationContext): DocumentResultRecord {
    const resultId = requiredText(resultIdValue, "resultId");
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = resultRow(connection, resultId);
      if (current === undefined) {
        throw new DocumentResultNotFoundError(`Document result was not found: ${resultId}`);
      }
      connection
        .prepare(`
          UPDATE document_result_items
          SET state = 'deleted', deleted_at = ?, updated_at = ?
          WHERE id = ? AND state <> 'deleted'
        `)
        .run(context.now, context.now, resultId);
      this.outbox.append(
        {
          eventType: "document.result.deleted",
          schemaVersion: 1,
          source: "document-result-registry",
          occurredAt: context.now,
          payload: { id: resultId, documentJobId: current.document_job_id },
          dedupeKey: `document.result.deleted:${resultId}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "delete",
          objectType: "document_result",
          objectId: resultId,
          correlationId: context.correlationId,
          details: {
            documentJobId: current.document_job_id,
            stateBefore: current.result_state,
            logicalDeletion: true
          }
        },
        connection
      );
      const row = resultRow(connection, resultId, true);
      if (row === undefined) throw new Error(`Deleted result was not found: ${resultId}`);
      return mapResult(row);
    });
  }
}
