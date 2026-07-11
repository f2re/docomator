import { randomUUID } from "node:crypto";

import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, type JsonValue } from "./json.js";

export interface AuditRecordInput {
  occurredAt?: Date | string;
  actorType: string;
  actorId?: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  correlationId: string;
  details?: JsonValue;
}

export interface AuditRecord {
  id: number;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  correlationId: string;
  details: JsonValue;
}

interface AuditRow {
  id: number;
  occurred_at: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  object_type: string;
  object_id: string | null;
  correlation_id: string;
  details_json: string;
}

function iso(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Invalid audit timestamp");
  }
  return date.toISOString();
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
  return normalized;
}

function mapAuditRow(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    objectType: row.object_type,
    objectId: row.object_id,
    correlationId: row.correlation_id,
    details: parseJson(row.details_json)
  };
}

export class AuditRepository {
  constructor(private readonly store: SqliteStore) {}

  record(input: AuditRecordInput, executor?: SqliteExecutor): number {
    const write = (connection: SqliteExecutor): number => {
      const result = connection
        .prepare(`
          INSERT INTO audit_log(
            occurred_at, actor_type, actor_id, action,
            object_type, object_id, correlation_id, details_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          iso(input.occurredAt),
          required(input.actorType, "actorType"),
          input.actorId ?? null,
          required(input.action, "action"),
          required(input.objectType, "objectType"),
          input.objectId ?? null,
          required(input.correlationId, "correlationId"),
          stringifyJson(input.details ?? {})
        );
      const id = Number(result.lastInsertRowid);
      if (!Number.isSafeInteger(id)) {
        throw new Error(`Audit identifier is outside the safe integer range: ${String(result.lastInsertRowid)}`);
      }
      return id;
    };

    return executor === undefined ? this.store.transaction(write) : write(executor);
  }

  listByCorrelation(correlationId: string): AuditRecord[] {
    const normalized = required(correlationId, "correlationId");
    return this.store.execute((connection) => {
      const rows = connection
        .prepare(`
          SELECT *
          FROM audit_log
          WHERE correlation_id = ?
          ORDER BY occurred_at ASC, id ASC
        `)
        .all(normalized) as unknown as AuditRow[];
      return rows.map(mapAuditRow);
    });
  }

  newCorrelationId(): string {
    return randomUUID();
  }
}
