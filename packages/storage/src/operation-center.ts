import { SqliteStore } from "./database.js";
import { parseJson, type JsonValue } from "./json.js";
import { SpaceNotFoundError, SpaceValidationError } from "./spaces.js";

export type OperationCenterKind =
  | "template_preview"
  | "document_generation"
  | "network_delivery"
  | "email_delivery";

export type OperationCenterState =
  | "pending"
  | "running"
  | "retry"
  | "completed"
  | "partial"
  | "failed";

export interface OperationCenterProgress {
  expected: number;
  completed: number;
  failed: number;
}

export interface OperationCenterRecord {
  id: string;
  kind: OperationCenterKind;
  state: OperationCenterState;
  title: string;
  format: "docx" | "xlsx";
  progress: OperationCenterProgress;
  attempts: number | null;
  maxAttempts: number | null;
  nextAttemptAt: string | null;
  error: JsonValue | null;
  correlationId: string;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}

interface OperationRow {
  source_id: string;
  kind: string;
  domain_state: string;
  title: string;
  format: string;
  expected_count: number;
  completed_count: number;
  failed_count: number;
  worker_state: string | null;
  attempts: number | null;
  max_attempts: number | null;
  next_attempt_at: string | null;
  error_json: string | null;
  correlation_id: string;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

function requiredIdentity(value: string): string {
  if (typeof value !== "string") {
    throw new SpaceValidationError("spaceId must be a string");
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new SpaceValidationError("spaceId must not be empty");
  }
  if (normalized.length > 160) {
    throw new SpaceValidationError("spaceId must not exceed 160 characters");
  }
  return normalized;
}

function operationKind(value: string): OperationCenterKind {
  if (
    value === "template_preview" ||
    value === "document_generation" ||
    value === "network_delivery" ||
    value === "email_delivery"
  ) {
    return value;
  }
  throw new Error(`Stored operation kind is invalid: ${value}`);
}

function operationFormat(value: string): "docx" | "xlsx" {
  if (value === "docx" || value === "xlsx") return value;
  throw new Error(`Stored operation format is invalid: ${value}`);
}

function operationState(row: OperationRow): OperationCenterState {
  if (row.domain_state === "completed" || row.domain_state === "ready") {
    return "completed";
  }
  if (row.domain_state === "partial") return "partial";
  if (row.domain_state === "failed" || row.worker_state === "dead_letter") {
    return "failed";
  }
  if (row.domain_state === "retry" || row.worker_state === "retry") {
    return "retry";
  }
  if (row.domain_state === "running" || row.worker_state === "running") {
    return "running";
  }
  if (row.domain_state === "pending") return "pending";
  throw new Error(
    `Stored operation state is invalid: ${row.kind}/${row.domain_state}`
  );
}

function nonNegative(value: number, name: string): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0) {
    throw new Error(`Stored operation ${name} is invalid: ${String(value)}`);
  }
  return result;
}

function nullableNonNegative(value: number | null, name: string): number | null {
  return value === null ? null : nonNegative(value, name);
}

function mapOperation(row: OperationRow): OperationCenterRecord {
  const kind = operationKind(row.kind);
  return {
    id: `${kind}:${row.source_id}`,
    kind,
    state: operationState(row),
    title: row.title,
    format: operationFormat(row.format),
    progress: {
      expected: nonNegative(row.expected_count, "expected count"),
      completed: nonNegative(row.completed_count, "completed count"),
      failed: nonNegative(row.failed_count, "failed count")
    },
    attempts: nullableNonNegative(row.attempts, "attempt count"),
    maxAttempts: nullableNonNegative(row.max_attempts, "maximum attempts"),
    nextAttemptAt: row.next_attempt_at,
    error: row.error_json === null ? null : parseJson(row.error_json),
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

export class OperationCenterRegistry {
  constructor(private readonly store: SqliteStore) {}

  list(spaceIdentity: string, limitValue = 50): OperationCenterRecord[] {
    const identity = requiredIdentity(spaceIdentity);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) {
      throw new SpaceValidationError("limit must be an integer in range 1..100");
    }

    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new SpaceNotFoundError(`Space was not found: ${identity}`);
      }

      const rows = connection
        .prepare(`
          WITH operations AS (
            SELECT
              p.id AS source_id,
              'template_preview' AS kind,
              p.state AS domain_state,
              d.title AS title,
              c.format AS format,
              1 AS expected_count,
              CASE WHEN p.state = 'ready' THEN 1 ELSE 0 END AS completed_count,
              CASE WHEN p.state = 'failed' THEN 1 ELSE 0 END AS failed_count,
              w.state AS worker_state,
              w.attempts AS attempts,
              w.max_attempts AS max_attempts,
              w.next_attempt_at AS next_attempt_at,
              p.error_json AS error_json,
              p.correlation_id AS correlation_id,
              p.requested_at AS created_at,
              p.completed_at AS completed_at,
              p.updated_at AS updated_at
            FROM template_release_previews p
            JOIN template_release_candidates c ON c.id = p.candidate_id
            JOIN template_drafts d ON d.id = c.draft_id
            JOIN worker_jobs w ON w.id = p.worker_job_id
            WHERE p.space_id = ?

            UNION ALL

            SELECT
              j.id AS source_id,
              'document_generation' AS kind,
              j.state AS domain_state,
              r.title AS title,
              r.format AS format,
              j.expected_count AS expected_count,
              j.generated_count AS completed_count,
              j.failed_count AS failed_count,
              w.state AS worker_state,
              w.attempts AS attempts,
              w.max_attempts AS max_attempts,
              w.next_attempt_at AS next_attempt_at,
              j.error_json AS error_json,
              j.correlation_id AS correlation_id,
              j.created_at AS created_at,
              j.completed_at AS completed_at,
              j.updated_at AS updated_at
            FROM document_generation_jobs j
            JOIN template_releases r ON r.id = j.active_release_id
            JOIN worker_jobs w ON w.id = j.worker_job_id
            WHERE j.space_id = ?

            UNION ALL

            SELECT
              d.id AS source_id,
              'network_delivery' AS kind,
              d.state AS domain_state,
              r.title AS title,
              r.format AS format,
              1 AS expected_count,
              CASE WHEN d.state = 'completed' THEN 1 ELSE 0 END AS completed_count,
              CASE WHEN d.state = 'failed' THEN 1 ELSE 0 END AS failed_count,
              NULL AS worker_state,
              NULL AS attempts,
              NULL AS max_attempts,
              NULL AS next_attempt_at,
              d.error_json AS error_json,
              d.correlation_id AS correlation_id,
              d.requested_at AS created_at,
              d.completed_at AS completed_at,
              d.updated_at AS updated_at
            FROM document_deliveries d
            JOIN document_generation_jobs j ON j.id = d.document_job_id
            JOIN template_releases r ON r.id = j.active_release_id
            WHERE d.space_id = ?

            UNION ALL

            SELECT
              d.id AS source_id,
              'email_delivery' AS kind,
              d.state AS domain_state,
              r.title AS title,
              r.format AS format,
              1 AS expected_count,
              CASE WHEN d.state = 'completed' THEN 1 ELSE 0 END AS completed_count,
              CASE WHEN d.state = 'failed' THEN 1 ELSE 0 END AS failed_count,
              w.state AS worker_state,
              w.attempts AS attempts,
              w.max_attempts AS max_attempts,
              w.next_attempt_at AS next_attempt_at,
              d.error_json AS error_json,
              d.correlation_id AS correlation_id,
              d.requested_at AS created_at,
              d.completed_at AS completed_at,
              d.updated_at AS updated_at
            FROM document_email_deliveries d
            JOIN document_generation_jobs j ON j.id = d.document_job_id
            JOIN template_releases r ON r.id = j.active_release_id
            JOIN worker_jobs w ON w.id = d.worker_job_id
            WHERE d.space_id = ?
          )
          SELECT *
          FROM operations
          ORDER BY updated_at DESC, kind ASC, source_id ASC
          LIMIT ?
        `)
        .all(space.id, space.id, space.id, space.id, limitValue) as unknown as OperationRow[];

      return rows.map(mapOperation);
    });
  }
}
