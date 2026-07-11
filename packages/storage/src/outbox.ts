import { randomUUID } from "node:crypto";

import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, type JsonValue } from "./json.js";

export type DomainEventDispatchState =
  | "pending"
  | "running"
  | "retry"
  | "published"
  | "dead_letter";

export interface DomainEvent {
  id: string;
  eventType: string;
  schemaVersion: number;
  source: string;
  occurredAt: string;
  payload: JsonValue;
  entityId: string | null;
  dedupeKey: string;
  publishedAt: string | null;
  createdAt: string;
  dispatchState: DomainEventDispatchState;
  dispatchAttempts: number;
  maxDispatchAttempts: number;
  nextDispatchAt: string;
  lockedBy: string | null;
  lockedAt: string | null;
  leaseExpiresAt: string | null;
  lastError: JsonValue | null;
}

export interface AppendDomainEventInput {
  id?: string;
  eventType: string;
  schemaVersion: number;
  source: string;
  occurredAt?: Date | string;
  payload: JsonValue;
  entityId?: string | null;
  dedupeKey: string;
  maxDispatchAttempts?: number;
  now?: Date | string;
}

interface DomainEventRow {
  id: string;
  event_type: string;
  schema_version: number;
  source: string;
  occurred_at: string;
  payload_json: string;
  entity_id: string | null;
  dedupe_key: string;
  published_at: string | null;
  created_at: string;
  dispatch_state: string;
  dispatch_attempts: number;
  max_dispatch_attempts: number;
  next_dispatch_at: string;
  dispatch_locked_by: string | null;
  dispatch_locked_at: string | null;
  dispatch_lease_expires_at: string | null;
  dispatch_last_error_json: string | null;
}

export class DomainEventIdempotencyConflictError extends Error {}
export class LostDomainEventLeaseError extends Error {}

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

function dispatchState(value: string): DomainEventDispatchState {
  if (["pending", "running", "retry", "published", "dead_letter"].includes(value)) {
    return value as DomainEventDispatchState;
  }
  throw new Error(`Unknown domain event dispatch state: ${value}`);
}

function mapRow(row: DomainEventRow): DomainEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    source: row.source,
    occurredAt: row.occurred_at,
    payload: parseJson(row.payload_json),
    entityId: row.entity_id,
    dedupeKey: row.dedupe_key,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    dispatchState: dispatchState(row.dispatch_state),
    dispatchAttempts: row.dispatch_attempts,
    maxDispatchAttempts: row.max_dispatch_attempts,
    nextDispatchAt: row.next_dispatch_at,
    lockedBy: row.dispatch_locked_by,
    lockedAt: row.dispatch_locked_at,
    leaseExpiresAt: row.dispatch_lease_expires_at,
    lastError:
      row.dispatch_last_error_json === null
        ? null
        : parseJson(row.dispatch_last_error_json)
  };
}

function readById(connection: SqliteExecutor, id: string): DomainEventRow | undefined {
  return connection.prepare("SELECT * FROM domain_events WHERE id = ?").get(id) as
    | DomainEventRow
    | undefined;
}

export class DomainEventOutbox {
  constructor(private readonly store: SqliteStore) {}

  append(
    input: AppendDomainEventInput,
    executor?: SqliteExecutor
  ): { event: DomainEvent; created: boolean } {
    const write = (connection: SqliteExecutor): { event: DomainEvent; created: boolean } => {
      const eventType = required(input.eventType, "eventType");
      const source = required(input.source, "source");
      const dedupeKey = required(input.dedupeKey, "dedupeKey");
      const payloadJson = stringifyJson(input.payload);
      if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
        throw new TypeError("schemaVersion must be a positive integer");
      }

      const existing = connection
        .prepare("SELECT * FROM domain_events WHERE dedupe_key = ?")
        .get(dedupeKey) as DomainEventRow | undefined;
      if (existing !== undefined) {
        if (
          existing.event_type !== eventType ||
          existing.schema_version !== input.schemaVersion ||
          existing.source !== source ||
          existing.payload_json !== payloadJson ||
          existing.entity_id !== (input.entityId ?? null)
        ) {
          throw new DomainEventIdempotencyConflictError(
            `Domain event dedupe key was reused with different input: ${dedupeKey}`
          );
        }
        return { event: mapRow(existing), created: false };
      }

      const maxAttempts = input.maxDispatchAttempts ?? 20;
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1_000) {
        throw new TypeError("maxDispatchAttempts must be an integer in range 1..1000");
      }
      const now = iso(input.now);
      const occurredAt = input.occurredAt === undefined ? now : iso(input.occurredAt);
      const id = input.id ?? randomUUID();
      connection
        .prepare(`
          INSERT INTO domain_events(
            id, event_type, schema_version, source, occurred_at,
            payload_json, entity_id, dedupe_key, published_at, created_at,
            dispatch_state, dispatch_attempts, max_dispatch_attempts,
            next_dispatch_at, dispatch_locked_by, dispatch_locked_at,
            dispatch_lease_expires_at, dispatch_last_error_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending', 0, ?, ?, NULL, NULL, NULL, NULL)
        `)
        .run(
          id,
          eventType,
          input.schemaVersion,
          source,
          occurredAt,
          payloadJson,
          input.entityId ?? null,
          dedupeKey,
          now,
          maxAttempts,
          now
        );
      const row = readById(connection, id);
      if (row === undefined) {
        throw new Error(`Inserted domain event was not found: ${id}`);
      }
      return { event: mapRow(row), created: true };
    };

    return executor === undefined ? this.store.transaction(write) : write(executor);
  }

  claimNext(
    workerIdValue: string,
    leaseDurationMs: number,
    nowValue?: Date | string
  ): DomainEvent | null {
    const workerId = required(workerIdValue, "workerId");
    if (
      !Number.isInteger(leaseDurationMs) ||
      leaseDurationMs < 100 ||
      leaseDurationMs > 86_400_000
    ) {
      throw new TypeError("leaseDurationMs must be an integer in range 100..86400000");
    }
    const now = iso(nowValue);
    const leaseExpiresAt = addMilliseconds(now, leaseDurationMs);

    return this.store.transaction((connection) => {
      this.reapExpiredWith(connection, now);
      const selected = connection
        .prepare(`
          SELECT *
          FROM domain_events
          WHERE dispatch_state IN ('pending', 'retry')
            AND next_dispatch_at <= ?
            AND dispatch_attempts < max_dispatch_attempts
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `)
        .get(now) as DomainEventRow | undefined;
      if (selected === undefined) {
        return null;
      }
      const claimed = connection
        .prepare(`
          UPDATE domain_events
          SET dispatch_state = 'running',
              dispatch_attempts = dispatch_attempts + 1,
              dispatch_locked_by = ?,
              dispatch_locked_at = ?,
              dispatch_lease_expires_at = ?
          WHERE id = ? AND dispatch_state = ?
          RETURNING *
        `)
        .get(workerId, now, leaseExpiresAt, selected.id, selected.dispatch_state) as
        | DomainEventRow
        | undefined;
      if (claimed === undefined) {
        throw new Error(`Domain event claim lost inside transaction: ${selected.id}`);
      }
      return mapRow(claimed);
    });
  }

  renewLease(
    eventId: string,
    workerId: string,
    leaseDurationMs: number,
    nowValue?: Date | string
  ): boolean {
    const now = iso(nowValue);
    const leaseExpiresAt = addMilliseconds(now, leaseDurationMs);
    const result = this.store.execute((connection) =>
      connection
        .prepare(`
          UPDATE domain_events
          SET dispatch_lease_expires_at = ?
          WHERE id = ?
            AND dispatch_state = 'running'
            AND dispatch_locked_by = ?
            AND dispatch_lease_expires_at > ?
        `)
        .run(leaseExpiresAt, eventId, workerId, now)
    );
    return Number(result.changes) === 1;
  }

  markPublished(
    eventId: string,
    workerId: string,
    nowValue?: Date | string
  ): DomainEvent {
    const now = iso(nowValue);
    const row = this.store.execute((connection) =>
      connection
        .prepare(`
          UPDATE domain_events
          SET dispatch_state = 'published',
              published_at = ?,
              dispatch_locked_by = NULL,
              dispatch_locked_at = NULL,
              dispatch_lease_expires_at = NULL
          WHERE id = ?
            AND dispatch_state = 'running'
            AND dispatch_locked_by = ?
            AND dispatch_lease_expires_at > ?
          RETURNING *
        `)
        .get(now, eventId, workerId, now) as DomainEventRow | undefined
    );
    if (row === undefined) {
      throw new LostDomainEventLeaseError(
        `Worker no longer owns domain event lease: ${eventId}`
      );
    }
    return mapRow(row);
  }

  fail(
    eventId: string,
    workerIdValue: string,
    error: JsonValue,
    options: {
      retryable?: boolean;
      retryAt?: Date | string;
      now?: Date | string;
    } = {}
  ): DomainEvent {
    const workerId = required(workerIdValue, "workerId");
    const now = iso(options.now);
    return this.store.transaction((connection) => {
      const row = readById(connection, eventId);
      if (
        row === undefined ||
        row.dispatch_state !== "running" ||
        row.dispatch_locked_by !== workerId ||
        row.dispatch_lease_expires_at === null ||
        row.dispatch_lease_expires_at <= now
      ) {
        throw new LostDomainEventLeaseError(
          `Worker no longer owns domain event lease: ${eventId}`
        );
      }
      const shouldRetry =
        (options.retryable ?? true) &&
        row.dispatch_attempts < row.max_dispatch_attempts;
      const state: DomainEventDispatchState = shouldRetry ? "retry" : "dead_letter";
      const nextDispatchAt = shouldRetry
        ? options.retryAt === undefined
          ? now
          : iso(options.retryAt)
        : row.next_dispatch_at;
      const updated = connection
        .prepare(`
          UPDATE domain_events
          SET dispatch_state = ?,
              next_dispatch_at = ?,
              dispatch_locked_by = NULL,
              dispatch_locked_at = NULL,
              dispatch_lease_expires_at = NULL,
              dispatch_last_error_json = ?
          WHERE id = ?
          RETURNING *
        `)
        .get(state, nextDispatchAt, stringifyJson(error), eventId) as
        | DomainEventRow
        | undefined;
      if (updated === undefined) {
        throw new Error(`Failed to update domain event: ${eventId}`);
      }
      return mapRow(updated);
    });
  }

  reapExpiredLeases(nowValue?: Date | string): LeaseReapResult {
    const now = iso(nowValue);
    return this.store.transaction((connection) => this.reapExpiredWith(connection, now));
  }

  getById(eventId: string): DomainEvent | null {
    return this.store.execute((connection) => {
      const row = readById(connection, eventId);
      return row === undefined ? null : mapRow(row);
    });
  }

  private reapExpiredWith(connection: SqliteExecutor, now: string): LeaseReapResult {
    const leaseError = stringifyJson({ code: "lease_expired", at: now });
    const dead = connection
      .prepare(`
        UPDATE domain_events
        SET dispatch_state = 'dead_letter',
            dispatch_locked_by = NULL,
            dispatch_locked_at = NULL,
            dispatch_lease_expires_at = NULL,
            dispatch_last_error_json = COALESCE(dispatch_last_error_json, ?)
        WHERE dispatch_state = 'running'
          AND dispatch_lease_expires_at <= ?
          AND dispatch_attempts >= max_dispatch_attempts
      `)
      .run(leaseError, now);
    const retried = connection
      .prepare(`
        UPDATE domain_events
        SET dispatch_state = 'retry',
            next_dispatch_at = ?,
            dispatch_locked_by = NULL,
            dispatch_locked_at = NULL,
            dispatch_lease_expires_at = NULL,
            dispatch_last_error_json = COALESCE(dispatch_last_error_json, ?)
        WHERE dispatch_state = 'running'
          AND dispatch_lease_expires_at <= ?
          AND dispatch_attempts < max_dispatch_attempts
      `)
      .run(now, leaseError, now);
    return {
      retried: Number(retried.changes),
      deadLettered: Number(dead.changes)
    };
  }
}

export interface LeaseReapResult {
  retried: number;
  deadLettered: number;
}
