import { hostname } from "node:os";

import { SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";

export type RuntimeServiceType = "api" | "worker";
export type RuntimeServiceState = "starting" | "running" | "stopping" | "failed";

export interface RuntimeHeartbeatInput {
  serviceType: RuntimeServiceType;
  instanceId: string;
  version: string;
  state: RuntimeServiceState;
  details?: JsonValue;
  now?: Date | string;
}

export interface RuntimeHeartbeatRecord {
  serviceType: RuntimeServiceType;
  instanceId: string;
  version: string;
  state: RuntimeServiceState;
  details: JsonValue;
  startedAt: string;
  updatedAt: string;
}

interface HeartbeatRow {
  service_type: string;
  instance_id: string;
  version: string;
  state: string;
  details_json: string;
  started_at: string;
  updated_at: string;
}

export class RuntimeStatusValidationError extends Error {
  override readonly name = "RuntimeStatusValidationError";
}

function requiredText(value: string, name: string, maximum = 240): string {
  if (typeof value !== "string") {
    throw new RuntimeStatusValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new RuntimeStatusValidationError(`${name} is invalid`);
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RuntimeStatusValidationError("Invalid runtime timestamp");
  }
  return date.toISOString();
}

function serviceType(value: string): RuntimeServiceType {
  if (value === "api" || value === "worker") return value;
  throw new RuntimeStatusValidationError("Unsupported runtime service type");
}

function serviceState(value: string): RuntimeServiceState {
  if (
    value === "starting" ||
    value === "running" ||
    value === "stopping" ||
    value === "failed"
  ) {
    return value;
  }
  throw new RuntimeStatusValidationError("Unsupported runtime service state");
}

function mapHeartbeat(row: HeartbeatRow): RuntimeHeartbeatRecord {
  return {
    serviceType: serviceType(row.service_type),
    instanceId: row.instance_id,
    version: row.version,
    state: serviceState(row.state),
    details: parseJson(row.details_json),
    startedAt: row.started_at,
    updatedAt: row.updated_at
  };
}

export function defaultRuntimeInstanceId(): string {
  return `${hostname()}:${process.pid}`;
}

export class RuntimeStatusRegistry {
  constructor(private readonly store: SqliteStore) {}

  heartbeat(input: RuntimeHeartbeatInput): RuntimeHeartbeatRecord {
    const service = serviceType(input.serviceType);
    const instanceId = requiredText(input.instanceId, "instanceId", 240);
    const version = requiredText(input.version, "version", 120);
    const state = serviceState(input.state);
    const details = toJsonValue(input.details ?? {});
    const now = timestamp(input.now);
    return this.store.transaction((connection) => {
      connection
        .prepare(`
          INSERT INTO runtime_service_heartbeats(
            service_type, instance_id, version, state,
            details_json, started_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(service_type, instance_id) DO UPDATE SET
            version = excluded.version,
            state = excluded.state,
            details_json = excluded.details_json,
            updated_at = excluded.updated_at
        `)
        .run(
          service,
          instanceId,
          version,
          state,
          stringifyJson(details),
          now,
          now
        );
      const row = connection
        .prepare(`
          SELECT service_type, instance_id, version, state,
                 details_json, started_at, updated_at
          FROM runtime_service_heartbeats
          WHERE service_type = ? AND instance_id = ?
        `)
        .get(service, instanceId) as HeartbeatRow | undefined;
      if (row === undefined) {
        throw new Error(`Runtime heartbeat was not stored: ${service}/${instanceId}`);
      }
      return mapHeartbeat(row);
    });
  }

  list(service?: RuntimeServiceType): RuntimeHeartbeatRecord[] {
    return this.store.execute((connection) => {
      const rows = connection
        .prepare(`
          SELECT service_type, instance_id, version, state,
                 details_json, started_at, updated_at
          FROM runtime_service_heartbeats
          WHERE (? IS NULL OR service_type = ?)
          ORDER BY updated_at DESC, service_type, instance_id
          LIMIT 100
        `)
        .all(service ?? null, service ?? null) as unknown as HeartbeatRow[];
      return rows.map(mapHeartbeat);
    });
  }

  latest(service: RuntimeServiceType): RuntimeHeartbeatRecord | null {
    return this.store.execute((connection) => {
      const row = connection
        .prepare(`
          SELECT service_type, instance_id, version, state,
                 details_json, started_at, updated_at
          FROM runtime_service_heartbeats
          WHERE service_type = ?
          ORDER BY updated_at DESC, instance_id
          LIMIT 1
        `)
        .get(service) as HeartbeatRow | undefined;
      return row === undefined ? null : mapHeartbeat(row);
    });
  }

  removeStale(olderThanValue: Date | string): number {
    const olderThan = timestamp(olderThanValue);
    return this.store.transaction((connection) =>
      Number(
        connection
          .prepare("DELETE FROM runtime_service_heartbeats WHERE updated_at < ?")
          .run(olderThan).changes
      )
    );
  }
}
