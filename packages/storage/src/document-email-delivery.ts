import { createHash, randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import {
  normalizeEmailAddress,
  normalizeEmailDisplayName
} from "./email-address.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { DomainEventOutbox } from "./outbox.js";
import { WorkerQueue, type WorkerJobState } from "./queue.js";

export type DocumentEmailDeliveryState =
  | "pending"
  | "running"
  | "retry"
  | "completed"
  | "failed";

export interface CreateDocumentEmailDeliveryInput {
  id?: string;
  spaceId: string;
  documentJobId: string;
  sourceSha256: string;
  attachmentName: string;
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  messageText: string;
  maxAttachmentBytes: number;
}

export interface DocumentEmailDeliveryRecord {
  id: string;
  spaceId: string;
  documentJobId: string;
  workerJobId: string;
  workerJobState: WorkerJobState;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  state: DocumentEmailDeliveryState;
  sourceSha256: string;
  attachmentName: string;
  attachmentBytes: number;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  messageText: string;
  messageId: string;
  smtpResponse: string | null;
  error: JsonValue | null;
  requestedBy: string | null;
  correlationId: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface DocumentEmailDeliveryWork {
  delivery: DocumentEmailDeliveryRecord;
}

interface DeliveryRow {
  id: string;
  space_id: string;
  document_job_id: string;
  worker_job_id: string;
  worker_state: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  state: string;
  source_sha256: string;
  attachment_name: string;
  attachment_bytes: number;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  message_text: string;
  message_id: string;
  dedupe_key: string;
  smtp_response: string | null;
  error_json: string | null;
  requested_by: string | null;
  correlation_id: string;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

interface FileRow {
  size_bytes: number;
}

export class DocumentEmailDeliveryValidationError extends Error {
  override readonly name = "DocumentEmailDeliveryValidationError";
}

export class DocumentEmailDeliveryNotFoundError extends Error {
  override readonly name = "DocumentEmailDeliveryNotFoundError";
}

export class DocumentEmailDeliveryConflictError extends Error {
  override readonly name = "DocumentEmailDeliveryConflictError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new DocumentEmailDeliveryValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DocumentEmailDeliveryValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new DocumentEmailDeliveryValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  if (/\u0000/u.test(normalized)) {
    throw new DocumentEmailDeliveryValidationError(`${name} contains a null character`);
  }
  return normalized;
}

function headerText(value: string, name: string, maximum: number): string {
  const normalized = requiredText(value, name, maximum).replace(/\s+/gu, " ");
  if (/[\r\n]/u.test(normalized)) {
    throw new DocumentEmailDeliveryValidationError(`${name} contains a line break`);
  }
  return normalized;
}

function messageText(value: string): string {
  if (typeof value !== "string") {
    throw new DocumentEmailDeliveryValidationError("messageText must be a string");
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (normalized.length === 0) {
    throw new DocumentEmailDeliveryValidationError("messageText must not be empty");
  }
  if (normalized.length > 20_000 || /\u0000/u.test(normalized)) {
    throw new DocumentEmailDeliveryValidationError("messageText is too long or invalid");
  }
  return normalized;
}

function attachmentName(value: string): string {
  const normalized = headerText(value, "attachmentName", 240)
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/gu, "");
  if (normalized.length === 0) {
    throw new DocumentEmailDeliveryValidationError("attachmentName is invalid");
  }
  return normalized;
}

function sha256(value: string): string {
  const normalized = requiredText(value, "sourceSha256", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DocumentEmailDeliveryValidationError(
      "sourceSha256 must contain 64 hexadecimal characters"
    );
  }
  return normalized;
}

function timestamp(value: Date | string | undefined): string {
  const date =
    value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DocumentEmailDeliveryValidationError("Invalid mutation timestamp");
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

function deliveryState(value: string): DocumentEmailDeliveryState {
  if (
    value === "pending" ||
    value === "running" ||
    value === "retry" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error(`Stored email delivery state is invalid: ${value}`);
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

function deliverySelect(): string {
  return `
    SELECT
      d.*,
      w.state AS worker_state,
      w.attempts,
      w.max_attempts,
      w.next_attempt_at
    FROM document_email_deliveries d
    JOIN worker_jobs w ON w.id = d.worker_job_id
  `;
}

function deliveryRow(
  connection: SqliteExecutor,
  deliveryId: string,
  spaceId?: string
): DeliveryRow | undefined {
  return connection
    .prepare(
      `${deliverySelect()} WHERE d.id = ?${spaceId === undefined ? "" : " AND d.space_id = ?"}`
    )
    .get(...(spaceId === undefined ? [deliveryId] : [deliveryId, spaceId])) as
    | DeliveryRow
    | undefined;
}

function mapDelivery(row: DeliveryRow): DocumentEmailDeliveryRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    documentJobId: row.document_job_id,
    workerJobId: row.worker_job_id,
    workerJobState: workerState(row.worker_state),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: row.next_attempt_at,
    state: deliveryState(row.state),
    sourceSha256: row.source_sha256,
    attachmentName: row.attachment_name,
    attachmentBytes: Number(row.attachment_bytes),
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    subject: row.subject,
    messageText: row.message_text,
    messageId: row.message_id,
    smtpResponse: row.smtp_response,
    error: row.error_json === null ? null : parseJson(row.error_json),
    requestedBy: row.requested_by,
    correlationId: row.correlation_id,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

function dedupeKey(input: {
  documentJobId: string;
  sourceSha256: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  messageText: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        documentJobId: input.documentJobId,
        sourceSha256: input.sourceSha256,
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName,
        subject: input.subject,
        messageText: input.messageText
      })
    )
    .digest("hex");
}

export class DocumentEmailDeliveryRegistry {
  private readonly queue: WorkerQueue;
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;

  constructor(
    private readonly store: SqliteStore,
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

  create(
    input: CreateDocumentEmailDeliveryInput,
    contextInput: MutationContext
  ): { delivery: DocumentEmailDeliveryRecord; created: boolean } {
    const id = input.id ?? randomUUID();
    const spaceIdentity = requiredText(input.spaceId, "spaceId", 160);
    const documentJobId = requiredText(
      input.documentJobId,
      "documentJobId",
      160
    );
    const sourceSha256 = sha256(input.sourceSha256);
    const normalizedAttachmentName = attachmentName(input.attachmentName);
    const recipient = normalizeEmailAddress(input.recipientEmail, "recipientEmail");
    const recipientName = normalizeEmailDisplayName(input.recipientName);
    const subject = headerText(input.subject, "subject", 300);
    const normalizedMessageText = messageText(input.messageText);
    if (
      !Number.isInteger(input.maxAttachmentBytes) ||
      input.maxAttachmentBytes < 1 ||
      input.maxAttachmentBytes > 512 * 1024 * 1024
    ) {
      throw new DocumentEmailDeliveryValidationError(
        "maxAttachmentBytes must be an integer in range 1..536870912"
      );
    }
    const context = contextValue(contextInput);
    const key = dedupeKey({
      documentJobId,
      sourceSha256,
      recipientEmail: recipient.address,
      recipientName,
      subject,
      messageText: normalizedMessageText
    });

    return this.store.transaction((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(spaceIdentity, spaceIdentity.toLowerCase()) as
        | { id: string }
        | undefined;
      if (space === undefined) {
        throw new DocumentEmailDeliveryNotFoundError(
          `Space was not found: ${spaceIdentity}`
        );
      }
      const job = connection
        .prepare(`
          SELECT id
          FROM document_generation_jobs
          WHERE id = ? AND space_id = ?
            AND state IN ('completed', 'partial')
            AND generated_count > 0
        `)
        .get(documentJobId, space.id);
      if (job === undefined) {
        throw new DocumentEmailDeliveryNotFoundError(
          `Completed document generation job was not found in this space: ${documentJobId}`
        );
      }
      const file = connection
        .prepare("SELECT size_bytes FROM files WHERE sha256 = ?")
        .get(sourceSha256) as FileRow | undefined;
      if (file === undefined) {
        throw new DocumentEmailDeliveryNotFoundError(
          `Document result file was not found: ${sourceSha256}`
        );
      }
      const sizeBytes = Number(file.size_bytes);
      if (sizeBytes > input.maxAttachmentBytes) {
        throw new DocumentEmailDeliveryValidationError(
          `Attachment size ${sizeBytes} exceeds the configured limit ${input.maxAttachmentBytes}`
        );
      }
      const existing = connection
        .prepare(`${deliverySelect()} WHERE d.dedupe_key = ?`)
        .get(key) as DeliveryRow | undefined;
      if (existing !== undefined) {
        return { delivery: mapDelivery(existing), created: false };
      }

      const queued = this.queue.enqueue(
        {
          jobType: "document.email.send",
          payload: toJsonValue({ emailDeliveryId: id }),
          priority: 70,
          maxAttempts: 4,
          idempotencyKey: `document.email.send:${id}`,
          now: context.now
        },
        connection
      );
      const messageId = `<docomator.${id}@local>`;
      connection
        .prepare(`
          INSERT INTO document_email_deliveries(
            id, space_id, document_job_id, worker_job_id, state,
            source_sha256, attachment_name, attachment_bytes,
            recipient_email, recipient_name, subject, message_text,
            message_id, dedupe_key, smtp_response, error_json,
            requested_by, correlation_id, requested_at, started_at,
            completed_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?,
            NULL, NULL, ?, ?, ?, NULL, NULL, ?
          )
        `)
        .run(
          id,
          space.id,
          documentJobId,
          queued.job.id,
          sourceSha256,
          normalizedAttachmentName,
          sizeBytes,
          recipient.address,
          recipientName,
          subject,
          normalizedMessageText,
          messageId,
          key,
          context.actorId,
          context.correlationId,
          context.now,
          context.now
        );
      this.outbox.append(
        {
          eventType: "document.email-delivery.requested",
          schemaVersion: 1,
          source: "document-email-delivery-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId: space.id,
            documentJobId,
            recipientEmail: recipient.address,
            sourceSha256,
            attachmentBytes: sizeBytes,
            workerJobId: queued.job.id
          },
          dedupeKey: `document.email-delivery.requested:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "request_email_delivery",
          objectType: "document_generation_job",
          objectId: documentJobId,
          correlationId: context.correlationId,
          details: {
            deliveryId: id,
            recipientEmail: recipient.address,
            sourceSha256,
            attachmentBytes: sizeBytes
          }
        },
        connection
      );
      const row = deliveryRow(connection, id, space.id);
      if (row === undefined) {
        throw new Error(`Created email delivery was not found: ${id}`);
      }
      return { delivery: mapDelivery(row), created: true };
    });
  }

  listForJob(
    spaceIdentity: string,
    documentJobIdValue: string
  ): DocumentEmailDeliveryRecord[] {
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
        throw new DocumentEmailDeliveryNotFoundError(
          `Space was not found: ${identity}`
        );
      }
      const rows = connection
        .prepare(`
          ${deliverySelect()}
          WHERE d.space_id = ? AND d.document_job_id = ?
          ORDER BY d.requested_at DESC, d.id DESC
        `)
        .all(space.id, documentJobId) as unknown as DeliveryRow[];
      return rows.map(mapDelivery);
    });
  }

  get(
    spaceIdentity: string,
    deliveryIdValue: string
  ): DocumentEmailDeliveryRecord {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const deliveryId = requiredText(deliveryIdValue, "deliveryId", 160);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new DocumentEmailDeliveryNotFoundError(
          `Space was not found: ${identity}`
        );
      }
      const row = deliveryRow(connection, deliveryId, space.id);
      if (row === undefined) {
        throw new DocumentEmailDeliveryNotFoundError(
          `Email delivery was not found in this space: ${deliveryId}`
        );
      }
      return mapDelivery(row);
    });
  }

  getWorkForWorker(deliveryIdValue: string): DocumentEmailDeliveryWork {
    const deliveryId = requiredText(deliveryIdValue, "deliveryId", 160);
    return this.store.execute((connection) => {
      const row = deliveryRow(connection, deliveryId);
      if (row === undefined) {
        throw new DocumentEmailDeliveryNotFoundError(
          `Email delivery was not found: ${deliveryId}`
        );
      }
      return { delivery: mapDelivery(row) };
    });
  }

  start(
    deliveryIdValue: string,
    contextInput: MutationContext
  ): DocumentEmailDeliveryRecord {
    const deliveryId = requiredText(deliveryIdValue, "deliveryId", 160);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = deliveryRow(connection, deliveryId);
      if (current === undefined) {
        throw new DocumentEmailDeliveryNotFoundError(
          `Email delivery was not found: ${deliveryId}`
        );
      }
      if (current.state === "completed") return mapDelivery(current);
      connection
        .prepare(`
          UPDATE document_email_deliveries
          SET state = 'running', started_at = COALESCE(started_at, ?),
              error_json = NULL, completed_at = NULL, updated_at = ?
          WHERE id = ? AND state IN ('pending', 'retry', 'failed', 'running')
        `)
        .run(context.now, context.now, deliveryId);
      const row = deliveryRow(connection, deliveryId);
      if (row === undefined) {
        throw new Error(`Started email delivery was not found: ${deliveryId}`);
      }
      return mapDelivery(row);
    });
  }

  complete(
    deliveryIdValue: string,
    smtpResponseValue: string,
    contextInput: MutationContext
  ): DocumentEmailDeliveryRecord {
    const deliveryId = requiredText(deliveryIdValue, "deliveryId", 160);
    const smtpResponse = headerText(
      smtpResponseValue,
      "smtpResponse",
      2_000
    );
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = deliveryRow(connection, deliveryId);
      if (current === undefined) {
        throw new DocumentEmailDeliveryNotFoundError(
          `Email delivery was not found: ${deliveryId}`
        );
      }
      if (current.state === "completed") return mapDelivery(current);
      connection
        .prepare(`
          UPDATE document_email_deliveries
          SET state = 'completed', smtp_response = ?, error_json = NULL,
              completed_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(smtpResponse, context.now, context.now, deliveryId);
      this.outbox.append(
        {
          eventType: "document.email-delivery.completed",
          schemaVersion: 1,
          source: "document-email-delivery-registry",
          occurredAt: context.now,
          payload: {
            id: deliveryId,
            documentJobId: current.document_job_id,
            recipientEmail: current.recipient_email,
            messageId: current.message_id,
            attachmentBytes: Number(current.attachment_bytes)
          },
          dedupeKey: `document.email-delivery.completed:${deliveryId}:v1`,
          now: context.now
        },
        connection
      );
      const row = deliveryRow(connection, deliveryId);
      if (row === undefined) {
        throw new Error(`Completed email delivery was not found: ${deliveryId}`);
      }
      return mapDelivery(row);
    });
  }

  failAttempt(
    deliveryIdValue: string,
    errorValue: JsonValue,
    final: boolean,
    contextInput: MutationContext
  ): DocumentEmailDeliveryRecord {
    const deliveryId = requiredText(deliveryIdValue, "deliveryId", 160);
    const error = toJsonValue(errorValue);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = deliveryRow(connection, deliveryId);
      if (current === undefined) {
        throw new DocumentEmailDeliveryNotFoundError(
          `Email delivery was not found: ${deliveryId}`
        );
      }
      if (current.state === "completed") {
        throw new DocumentEmailDeliveryConflictError(
          "Completed email delivery cannot be replaced with a failure"
        );
      }
      connection
        .prepare(`
          UPDATE document_email_deliveries
          SET state = ?, error_json = ?, completed_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          final ? "failed" : "retry",
          stringifyJson(error),
          final ? context.now : null,
          context.now,
          deliveryId
        );
      const row = deliveryRow(connection, deliveryId);
      if (row === undefined) {
        throw new Error(`Failed email delivery was not found: ${deliveryId}`);
      }
      return mapDelivery(row);
    });
  }
}
