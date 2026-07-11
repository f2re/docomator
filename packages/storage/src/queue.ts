import { randomUUID } from "node:crypto";

import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, type JsonValue } from "./json.js";

export type WorkerJobState =
  | "pending"
  | "running"
  | "retry"
  | "completed"
  | "dead_letter";

export interface WorkerJob {
  id: string;
  jobType: string;
  state: WorkerJobState;
  priority: number;
  payload: JsonValue;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lockedBy: string | null;
  lockedAt: string | null;
  leaseExpiresAt: string | null;
  lastError: JsonValue | null;
  idempotencyKey: string | null;
  completedAt: string | null;
  deadLetteredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueWorkerJobInput {
  id?: string;
  jobType: string;
  payload: JsonValue;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date | string;
  idempotencyKey?: string | null;
  now?: Date | string;
}

export interface ClaimWorkerJobInput {
  workerId: string;
  leaseDurationMs: number;
  now?: Date | string;
}

export interface FailWorkerJobInput {
  jobId: string;
  workerId: string;
  error: JsonValue;
  retryable?: boolean;
  retryAt?: Date | string;
  now?: Date | string;
}

export interface LeaseReapResult {
  retried: number;
  deadLettered: number;
}

interface WorkerJobRow {
  id: string;
  job_type: string;
  state: string;
  priority: number;
  payload_json: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_by: string | null;
  locked_at: string | null;
  lease_expires_at: string | null;
  last_error_json: string | null;
  idempotency_key: string | null;
  completed_at: string | null;
  dead_lettered_at: string | null;
  created_at: string;
  updated_at: string;
}

export class WorkerJobIdempotencyConflictError extends Error {}
export class LostWorkerJobLeaseError extends Error {}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return normalized;
}

function iso(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Invalid timestamp");
  }
  return date.toISOString();
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}

function workerJobState(value: string): WorkerJobState {
  if (["pending", "running", "retry", "completed", "dead_letter"].includes(value)) {
    return value as WorkerJobState;
  }
  throw new Error(`Unknown worker job state: ${value}`);
}

function mapRow(row: WorkerJobRow): WorkerJob {
  return {
    id: row.id,
    jobType: row.job_type,
    state: workerJobState(row.state),
    priority: row.priority,
    payload: parseJson(row.payload_json),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    leaseExpiresAt: row.lease_expires_at,
    lastError: row.last_error_json === null ? null : parseJson(row.last_error_json),
    idempotencyKey: row.idempotency_key,
    completedAt: row.completed_at,
    deadLetteredAt: row.dead_lettered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function readById(connection: SqliteExecutor, id: string): WorkerJobRow | undefined {
  return connection.prepare("SELECT * FROM worker_jobs WHERE id = ?").get(id) as
    | WorkerJobRow
    | undefined;
}

export class WorkerQueue {
  constructor(private readonly store: SqliteStore) {}

  enqueue(
    input: EnqueueWorkerJobInput,
    executor?: SqliteExecutor
  ): { job: WorkerJob; created: boolean } {
    const write = (connection: SqliteExecutor): { job: WorkerJob; created: boolean } => {
      const jobType = required(input.jobType, "jobType");
      const payloadJson = stringifyJson(input.payload);
      const idempotencyKey =
        input.idempotencyKey === undefined || input.idempotencyKey === null
          ? null
          : required(input.idempotencyKey, "idempotencyKey");

      if (idempotencyKey !== null) {
        const existing = connection
          .prepare("SELECT * FROM worker_jobs WHERE idempotency_key = ?")
          .get(idempotencyKey) as WorkerJobRow | undefined;
        if (existing !== undefined) {
          if (existing.job_type !== jobType || existing.payload_json !== payloadJson) {
            throw new WorkerJobIdempotencyConflictError(
              `Worker job idempotency key was reused with different input: ${idempotencyKey}`
            );
          }
          return { job: mapRow(existing), created: false };
        }
      }

      const priority = input.priority ?? 100;
      const maxAttempts = input.maxAttempts ?? 5;
      if (!Number.isInteger(priority)) {
        throw new TypeError("priority must be an integer");
      }
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1_000) {
        throw new TypeError("maxAttempts must be an integer in range 1..1000");
      }

      const now = iso(input.now);
      const availableAt = input.availableAt === undefined ? now : iso(input.availableAt);
      const id = input.id ?? randomUUID();
      connection
        .prepare(`
          INSERT INTO worker_jobs(
            id, job_type, state, priority, payload_json,
            attempts, max_attempts, next_attempt_at,
            locked_by, locked_at, lease_expires_at, last_error_json,
            created_at, updated_at, idempotency_key, completed_at, dead_lettered_at
          ) VALUES (?, ?, 'pending', ?, ?, 0, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, NULL)
        `)
        .run(
          id,
          jobType,
          priority,
          payloadJson,
          maxAttempts,
          availableAt,
          now,
          now,
          idempotencyKey
        );

      const row = readById(connection, id);
      if (row === undefined) {
        throw new Error(`Inserted worker job was not found: ${id}`);
      }
      return { job: mapRow(row), created: true };
    };

    return executor === undefined ? this.store.transaction(write) : write(executor);
  }

  claimNext(input: ClaimWorkerJobInput): WorkerJob | null {
    const workerId = required(input.workerId, "workerId");
    if (
      !Number.isInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 100 ||
      input.leaseDurationMs > 86_400_000
    ) {
      throw new TypeError("leaseDurationMs must be an integer in range 100..86400000");
    }
    const now = iso(input.now);
    const leaseExpiresAt = addMilliseconds(now, input.leaseDurationMs);

    return this.store.transaction((connection) => {
      this.reapExpiredWith(connection, now);
      const selected = connection
        .prepare(`
          SELECT *
          FROM worker_jobs
          WHERE state IN ('pending', 'retry')
            AND next_attempt_at <= ?
            AND attempts < max_attempts
          ORDER BY priority ASC, created_at ASC, id ASC
          LIMIT 1
        `)
        .get(now) as WorkerJobRow | undefined;
      if (selected === undefined) {
        return null;
      }

      const claimed = connection
        .prepare(`
          UPDATE worker_jobs
          SET state = 'running',
              attempts = attempts + 1,
              locked_by = ?,
              locked_at = ?,
              lease_expires_at = ?,
              updated_at = ?
          WHERE id = ? AND state = ?
          RETURNING *
        `)
        .get(workerId, now, leaseExpiresAt, now, selected.id, selected.state) as
        | WorkerJobRow
        | undefined;
      if (claimed === undefined) {
        throw new Error(`Worker job claim lost inside transaction: ${selected.id}`);
      }
      return mapRow(claimed);
    });
  }

  renewLease(
    jobId: string,
    workerId: string,
    leaseDurationMs: number,
    nowValue?: Date | string
  ): boolean {
    const now = iso(nowValue);
    const leaseExpiresAt = addMilliseconds(now, leaseDurationMs);
    const result = this.store.execute((connection) =>
      connection
        .prepare(`
          UPDATE worker_jobs
          SET lease_expires_at = ?, updated_at = ?
          WHERE id = ?
            AND state = 'running'
            AND locked_by = ?
            AND lease_expires_at > ?
        `)
        .run(leaseExpiresAt, now, jobId, workerId, now)
    );
    return Number(result.changes) === 1;
  }

  complete(jobId: string, workerId: string, nowValue?: Date | string): WorkerJob {
    const now = iso(nowValue);
    const row = this.store.execute((connection) =>
      connection
        .prepare(`
          UPDATE worker_jobs
          SET state = 'completed',
              completed_at = ?,
              locked_by = NULL,
              locked_at = NULL,
              lease_expires_at = NULL,
              updated_at = ?
          WHERE id = ?
            AND state = 'running'
            AND locked_by = ?
            AND lease_expires_at > ?
          RETURNING *
        `)
        .get(now, now, jobId, workerId, now) as WorkerJobRow | undefined
    );
    if (row === undefined) {
      throw new LostWorkerJobLeaseError(`Worker no longer owns job lease: ${jobId}`);
    }
    return mapRow(row);
  }

  fail(input: FailWorkerJobInput): WorkerJob {
    const workerId = required(input.workerId, "workerId");
    const now = iso(input.now);
    return this.store.transaction((connection) => {
      const row = readById(connection, input.jobId);
      if (
        row === undefined ||
        row.state !== "running" ||
        row.locked_by !== workerId ||
        row.lease_expires_at === null ||
        row.lease_expires_at <= now
      ) {
        throw new LostWorkerJobLeaseError(
          `Worker no longer owns job lease: ${input.jobId}`
        );
      }

      const shouldRetry = (input.retryable ?? true) && row.attempts < row.max_attempts;
      const state: WorkerJobState = shouldRetry ? "retry" : "dead_letter";
      const nextAttemptAt = shouldRetry
        ? input.retryAt === undefined
          ? now
          : iso(input.retryAt)
        : row.next_attempt_at;
      const updated = connection
        .prepare(`
          UPDATE worker_jobs
          SET state = ?,
              next_attempt_at = ?,
              locked_by = NULL,
              locked_at = NULL,
              lease_expires_at = NULL,
              last_error_json = ?,
              completed_at = ?,
              dead_lettered_at = ?,
              updated_at = ?
          WHERE id = ?
          RETURNING *
        `)
        .get(
          state,
          nextAttemptAt,
          stringifyJson(input.error),
          shouldRetry ? null : now,
          shouldRetry ? null : now,
          now,
          input.jobId
        ) as WorkerJobRow | undefined;
      if (updated === undefined) {
        throw new Error(`Failed to update worker job: ${input.jobId}`);
      }
      return mapRow(updated);
    });
  }

  reapExpiredLeases(nowValue?: Date | string): LeaseReapResult {
    const now = iso(nowValue);
    return this.store.transaction((connection) => this.reapExpiredWith(connection, now));
  }

  getById(jobId: string): WorkerJob | null {
    return this.store.execute((connection) => {
      const row = readById(connection, jobId);
      return row === undefined ? null : mapRow(row);
    });
  }

  getDepths(): Record<WorkerJobState, number> {
    return this.store.execute((connection) => {
      const rows = connection
        .prepare("SELECT state, COUNT(*) AS count FROM worker_jobs GROUP BY state")
        .all() as unknown as Array<{ state: string; count: number }>;
      const result: Record<WorkerJobState, number> = {
        pending: 0,
        running: 0,
        retry: 0,
        completed: 0,
        dead_letter: 0
      };
      for (const row of rows) {
        result[workerJobState(row.state)] = Number(row.count);
      }
      return result;
    });
  }

  private reapExpiredWith(connection: SqliteExecutor, now: string): LeaseReapResult {
    const leaseError = stringifyJson({ code: "lease_expired", at: now });
    const dead = connection
      .prepare(`
        UPDATE worker_jobs
        SET state = 'dead_letter',
            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            last_error_json = COALESCE(last_error_json, ?),
            completed_at = ?,
            dead_lettered_at = ?,
            updated_at = ?
        WHERE state = 'running'
          AND lease_expires_at <= ?
          AND attempts >= max_attempts
      `)
      .run(leaseError, now, now, now, now);
    const retried = connection
      .prepare(`
        UPDATE worker_jobs
        SET state = 'retry',
            next_attempt_at = ?,
            locked_by = NULL,
            locked_at = NULL,
            lease_expires_at = NULL,
            last_error_json = COALESCE(last_error_json, ?),
            updated_at = ?
        WHERE state = 'running'
          AND lease_expires_at <= ?
          AND attempts < max_attempts
      `)
      .run(now, leaseError, now, now);
    return {
      retried: Number(retried.changes),
      deadLettered: Number(dead.changes)
    };
  }
}
