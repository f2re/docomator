import { randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";

export type DocumentDeliveryState = "pending" | "completed" | "failed";
export type DocumentDeliveryChannel = "network_folder";

export interface CreateDocumentDeliveryInput {
  id?: string;
  spaceId: string;
  documentJobId: string;
  sourceSha256: string;
  destinationRelative: string;
}

export interface CompleteDocumentDeliveryInput {
  deliveryId: string;
  deliveredName: string;
  deliveredBytes: number;
}

export interface DocumentDeliveryRecord {
  id: string;
  spaceId: string;
  documentJobId: string;
  channel: DocumentDeliveryChannel;
  state: DocumentDeliveryState;
  sourceSha256: string;
  destinationRelative: string;
  deliveredName: string | null;
  deliveredBytes: number | null;
  error: JsonValue | null;
  requestedBy: string | null;
  correlationId: string;
  requestedAt: string;
  completedAt: string | null;
  updatedAt: string;
}

interface DeliveryRow {
  id: string;
  space_id: string;
  document_job_id: string;
  channel: string;
  state: string;
  source_sha256: string;
  destination_relative: string;
  delivered_name: string | null;
  delivered_bytes: number | null;
  error_json: string | null;
  requested_by: string | null;
  correlation_id: string;
  requested_at: string;
  completed_at: string | null;
  updated_at: string;
}

export class DocumentDeliveryValidationError extends Error {
  override readonly name = "DocumentDeliveryValidationError";
}

export class DocumentDeliveryNotFoundError extends Error {
  override readonly name = "DocumentDeliveryNotFoundError";
}

export class DocumentDeliveryConflictError extends Error {
  override readonly name = "DocumentDeliveryConflictError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new DocumentDeliveryValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DocumentDeliveryValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new DocumentDeliveryValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function sha256(value: string): string {
  const normalized = requiredText(value, "sourceSha256", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DocumentDeliveryValidationError(
      "sourceSha256 must contain 64 hexadecimal characters"
    );
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DocumentDeliveryValidationError("Invalid mutation timestamp");
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

function state(value: string): DocumentDeliveryState {
  if (value === "pending" || value === "completed" || value === "failed") {
    return value;
  }
  throw new Error(`Stored document delivery state is invalid: ${value}`);
}

function channel(value: string): DocumentDeliveryChannel {
  if (value === "network_folder") return value;
  throw new Error(`Stored document delivery channel is invalid: ${value}`);
}

function mapDelivery(row: DeliveryRow): DocumentDeliveryRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    documentJobId: row.document_job_id,
    channel: channel(row.channel),
    state: state(row.state),
    sourceSha256: row.source_sha256,
    destinationRelative: row.destination_relative,
    deliveredName: row.delivered_name,
    deliveredBytes:
      row.delivered_bytes === null ? null : Number(row.delivered_bytes),
    error: row.error_json === null ? null : parseJson(row.error_json),
    requestedBy: row.requested_by,
    correlationId: row.correlation_id,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

function deliveryRow(
  connection: SqliteExecutor,
  deliveryId: string,
  spaceId?: string
): DeliveryRow | undefined {
  return connection
    .prepare(
      `SELECT * FROM document_deliveries WHERE id = ?${spaceId === undefined ? "" : " AND space_id = ?"}`
    )
    .get(...(spaceId === undefined ? [deliveryId] : [deliveryId, spaceId])) as
    | DeliveryRow
    | undefined;
}

export class DocumentDeliveryRegistry {
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;

  constructor(
    private readonly store: SqliteStore,
    options: { outbox?: DomainEventOutbox; audit?: AuditRepository } = {}
  ) {
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
  }

  createNetworkAttempt(
    input: CreateDocumentDeliveryInput,
    contextInput: MutationContext
  ): { delivery: DocumentDeliveryRecord; created: boolean } {
    const id = input.id ?? randomUUID();
    const spaceId = requiredText(input.spaceId, "spaceId", 160);
    const documentJobId = requiredText(
      input.documentJobId,
      "documentJobId",
      160
    );
    const sourceSha256 = sha256(input.sourceSha256);
    const destinationRelative = requiredText(
      input.destinationRelative,
      "destinationRelative",
      1_000
    );
    const context = contextValue(contextInput);

    return this.store.transaction((connection) => {
      const job = connection
        .prepare(
          "SELECT id FROM document_generation_jobs WHERE id = ? AND space_id = ? AND state IN ('completed', 'partial') AND generated_count > 0"
        )
        .get(documentJobId, spaceId);
      if (job === undefined) {
        throw new DocumentDeliveryNotFoundError(
          `Completed document generation job was not found in this space: ${documentJobId}`
        );
      }
      const existing = connection
        .prepare(`
          SELECT *
          FROM document_deliveries
          WHERE document_job_id = ?
            AND channel = 'network_folder'
            AND source_sha256 = ?
            AND destination_relative = ?
        `)
        .get(documentJobId, sourceSha256, destinationRelative) as
        | DeliveryRow
        | undefined;
      if (existing !== undefined) {
        return { delivery: mapDelivery(existing), created: false };
      }
      connection
        .prepare(`
          INSERT INTO document_deliveries(
            id, space_id, document_job_id, channel, state,
            source_sha256, destination_relative, delivered_name,
            delivered_bytes, error_json, requested_by, correlation_id,
            requested_at, completed_at, updated_at
          ) VALUES (?, ?, ?, 'network_folder', 'pending', ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?)
        `)
        .run(
          id,
          spaceId,
          documentJobId,
          sourceSha256,
          destinationRelative,
          context.actorId,
          context.correlationId,
          context.now,
          context.now
        );
      this.outbox.append(
        {
          eventType: "document.delivery.requested",
          schemaVersion: 1,
          source: "document-delivery-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId,
            documentJobId,
            channel: "network_folder",
            sourceSha256,
            destinationRelative
          },
          dedupeKey: `document.delivery.requested:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "request_network_delivery",
          objectType: "document_generation_job",
          objectId: documentJobId,
          correlationId: context.correlationId,
          details: { deliveryId: id, destinationRelative, sourceSha256 }
        },
        connection
      );
      const row = deliveryRow(connection, id, spaceId);
      if (row === undefined) {
        throw new Error(`Created document delivery was not found: ${id}`);
      }
      return { delivery: mapDelivery(row), created: true };
    });
  }

  completeNetworkAttempt(
    input: CompleteDocumentDeliveryInput,
    contextInput: MutationContext
  ): DocumentDeliveryRecord {
    const deliveryId = requiredText(input.deliveryId, "deliveryId", 160);
    const deliveredName = requiredText(
      input.deliveredName,
      "deliveredName",
      500
    );
    if (
      !Number.isInteger(input.deliveredBytes) ||
      input.deliveredBytes < 0 ||
      input.deliveredBytes > Number.MAX_SAFE_INTEGER
    ) {
      throw new DocumentDeliveryValidationError(
        "deliveredBytes must be a non-negative safe integer"
      );
    }
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = deliveryRow(connection, deliveryId);
      if (current === undefined) {
        throw new DocumentDeliveryNotFoundError(
          `Document delivery was not found: ${deliveryId}`
        );
      }
      if (current.state === "completed") return mapDelivery(current);
      connection
        .prepare(`
          UPDATE document_deliveries
          SET state = 'completed', delivered_name = ?, delivered_bytes = ?,
              error_json = NULL, completed_at = ?, updated_at = ?
          WHERE id = ? AND state IN ('pending', 'failed')
        `)
        .run(
          deliveredName,
          input.deliveredBytes,
          context.now,
          context.now,
          deliveryId
        );
      this.outbox.append(
        {
          eventType: "document.delivery.completed",
          schemaVersion: 1,
          source: "document-delivery-registry",
          occurredAt: context.now,
          payload: {
            id: deliveryId,
            documentJobId: current.document_job_id,
            deliveredName,
            deliveredBytes: input.deliveredBytes
          },
          dedupeKey: `document.delivery.completed:${deliveryId}:v1`,
          now: context.now
        },
        connection
      );
      const row = deliveryRow(connection, deliveryId);
      if (row === undefined) {
        throw new Error(`Completed document delivery was not found: ${deliveryId}`);
      }
      return mapDelivery(row);
    });
  }

  failNetworkAttempt(
    deliveryIdValue: string,
    errorValue: JsonValue,
    contextInput: MutationContext
  ): DocumentDeliveryRecord {
    const deliveryId = requiredText(deliveryIdValue, "deliveryId", 160);
    const error = toJsonValue(errorValue);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = deliveryRow(connection, deliveryId);
      if (current === undefined) {
        throw new DocumentDeliveryNotFoundError(
          `Document delivery was not found: ${deliveryId}`
        );
      }
      if (current.state === "completed") {
        throw new DocumentDeliveryConflictError(
          "Completed document delivery cannot be replaced with a failure"
        );
      }
      connection
        .prepare(`
          UPDATE document_deliveries
          SET state = 'failed', error_json = ?, completed_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(stringifyJson(error), context.now, context.now, deliveryId);
      const row = deliveryRow(connection, deliveryId);
      if (row === undefined) {
        throw new Error(`Failed document delivery was not found: ${deliveryId}`);
      }
      return mapDelivery(row);
    });
  }

  listForJob(
    spaceIdentity: string,
    documentJobIdValue: string
  ): DocumentDeliveryRecord[] {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const documentJobId = requiredText(
      documentJobIdValue,
      "documentJobId",
      160
    );
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new DocumentDeliveryNotFoundError(`Space was not found: ${identity}`);
      }
      const rows = connection
        .prepare(`
          SELECT *
          FROM document_deliveries
          WHERE space_id = ? AND document_job_id = ?
          ORDER BY requested_at DESC, id DESC
        `)
        .all(space.id, documentJobId) as unknown as DeliveryRow[];
      return rows.map(mapDelivery);
    });
  }
}
