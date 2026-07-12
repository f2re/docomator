import { createHash, randomUUID } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import type { MutationContext } from "./knowledge.js";
import { ContentAddressedObjectStore } from "./object-store.js";
import { DomainEventOutbox } from "./outbox.js";

export type QuarantineDocumentFormat = "docx" | "xlsx";
export type QuarantineDecision = "accepted" | "accepted_with_warnings";

export interface SaveQuarantineDocumentInput {
  id?: string;
  spaceId: string;
  fileName: string;
  mediaType: string;
  format: QuarantineDocumentFormat;
  decision: QuarantineDecision;
  buffer: Uint8Array;
  report: JsonValue;
  expectedSha256?: string;
}

export interface ListQuarantineDocumentsOptions {
  limit?: number;
}

export interface QuarantineDocumentRecord {
  id: string;
  spaceId: string;
  fileId: string;
  fileName: string;
  mediaType: string;
  format: QuarantineDocumentFormat;
  decision: QuarantineDecision;
  sha256: string;
  sizeBytes: number;
  storagePath: string;
  report: JsonValue;
  createdBy: string | null;
  correlationId: string;
  createdAt: string;
}

interface QuarantineRow {
  id: string;
  space_id: string;
  file_id: string;
  original_name: string;
  media_type: string;
  format: string;
  decision: string;
  report_json: string;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
}

interface FileRow {
  id: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
}

export class DocumentQuarantineValidationError extends Error {
  override readonly name = "DocumentQuarantineValidationError";
}

export class DocumentQuarantineNotFoundError extends Error {
  override readonly name = "DocumentQuarantineNotFoundError";
}

function requiredText(value: string, name: string, maximum = 500): string {
  if (typeof value !== "string") {
    throw new DocumentQuarantineValidationError(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new DocumentQuarantineValidationError(`${name} must not be empty`);
  }
  if (normalized.length > maximum) {
    throw new DocumentQuarantineValidationError(
      `${name} must not exceed ${maximum} characters`
    );
  }
  return normalized;
}

function optionalSha256(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new DocumentQuarantineValidationError(
      "expectedSha256 must contain 64 hexadecimal characters"
    );
  }
  return normalized;
}

function normalizeFormat(value: string): QuarantineDocumentFormat {
  if (value === "docx" || value === "xlsx") {
    return value;
  }
  throw new DocumentQuarantineValidationError(`Unsupported document format: ${value}`);
}

function normalizeDecision(value: string): QuarantineDecision {
  if (value === "accepted" || value === "accepted_with_warnings") {
    return value;
  }
  throw new DocumentQuarantineValidationError(
    "Only documents accepted by the safety check can be placed in quarantine"
  );
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new DocumentQuarantineValidationError(
      "limit must be an integer in range 1..500"
    );
  }
  return limit;
}

function normalizeTimestamp(value: Date | string | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DocumentQuarantineValidationError("Invalid mutation timestamp");
  }
  return date.toISOString();
}

function normalizeContext(context: MutationContext): {
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
    now: normalizeTimestamp(context.now)
  };
}

function mapFormat(value: string): QuarantineDocumentFormat {
  if (value === "docx" || value === "xlsx") {
    return value;
  }
  throw new Error(`Stored quarantine document format is invalid: ${value}`);
}

function mapDecision(value: string): QuarantineDecision {
  if (value === "accepted" || value === "accepted_with_warnings") {
    return value;
  }
  throw new Error(`Stored quarantine decision is invalid: ${value}`);
}

function mapRecord(row: QuarantineRow): QuarantineDocumentRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    fileId: row.file_id,
    fileName: row.original_name,
    mediaType: row.media_type,
    format: mapFormat(row.format),
    decision: mapDecision(row.decision),
    sha256: row.sha256,
    sizeBytes: Number(row.size_bytes),
    storagePath: row.storage_path,
    report: parseJson(row.report_json),
    createdBy: row.created_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at
  };
}

function quarantineRow(
  connection: SqliteExecutor,
  spaceId: string,
  recordId: string
): QuarantineRow | undefined {
  return connection
    .prepare(`
      SELECT q.*, f.sha256, f.size_bytes, f.storage_path
      FROM document_quarantine_records q
      JOIN files f ON f.id = q.file_id
      WHERE q.id = ? AND q.space_id = ?
    `)
    .get(recordId, spaceId) as QuarantineRow | undefined;
}

export class DocumentQuarantineRegistry {
  private readonly outbox: DomainEventOutbox;
  private readonly audit: AuditRepository;

  constructor(
    private readonly store: SqliteStore,
    private readonly objectStore: ContentAddressedObjectStore,
    options: { outbox?: DomainEventOutbox; audit?: AuditRepository } = {}
  ) {
    this.outbox = options.outbox ?? new DomainEventOutbox(store);
    this.audit = options.audit ?? new AuditRepository(store);
  }

  async saveAcceptedDocument(
    input: SaveQuarantineDocumentInput,
    contextInput: MutationContext
  ): Promise<QuarantineDocumentRecord> {
    const id = input.id ?? randomUUID();
    const spaceId = requiredText(input.spaceId, "spaceId", 160);
    const fileName = requiredText(input.fileName, "fileName", 255);
    if (fileName.includes("/") || fileName.includes("\\")) {
      throw new DocumentQuarantineValidationError(
        "fileName must not contain a path"
      );
    }
    const mediaType = requiredText(input.mediaType, "mediaType", 255);
    const format = normalizeFormat(input.format);
    const decision = normalizeDecision(input.decision);
    const report = toJsonValue(input.report);
    const context = normalizeContext(contextInput);
    const buffer = Buffer.from(input.buffer);
    if (buffer.length === 0) {
      throw new DocumentQuarantineValidationError("Document buffer must not be empty");
    }

    const expectedSha256 = optionalSha256(input.expectedSha256);
    const actualSha256 = createHash("sha256").update(buffer).digest("hex");
    if (expectedSha256 !== null && expectedSha256 !== actualSha256) {
      throw new DocumentQuarantineValidationError(
        "Document checksum changed after the safety check"
      );
    }

    const stored = await this.objectStore.putBuffer(buffer);
    if (stored.sha256 !== actualSha256 || stored.sizeBytes !== buffer.length) {
      throw new Error("Content-addressed object verification failed after storage");
    }

    return this.store.transaction((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(spaceId, spaceId.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new DocumentQuarantineNotFoundError(`Space was not found: ${spaceId}`);
      }

      let file = connection
        .prepare("SELECT id, sha256, size_bytes, storage_path FROM files WHERE sha256 = ?")
        .get(stored.sha256) as FileRow | undefined;
      if (file === undefined) {
        const fileId = randomUUID();
        connection
          .prepare(`
            INSERT INTO files(
              id, sha256, original_name, media_type, size_bytes,
              storage_path, created_at, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            fileId,
            stored.sha256,
            fileName,
            mediaType,
            stored.sizeBytes,
            stored.relativePath,
            context.now,
            context.actorId
          );
        file = {
          id: fileId,
          sha256: stored.sha256,
          size_bytes: stored.sizeBytes,
          storage_path: stored.relativePath
        };
      } else if (
        Number(file.size_bytes) !== stored.sizeBytes ||
        file.storage_path !== stored.relativePath
      ) {
        throw new Error("Stored file metadata conflicts with content-addressed object");
      }

      const existing = connection
        .prepare(`
          SELECT q.*, f.sha256, f.size_bytes, f.storage_path
          FROM document_quarantine_records q
          JOIN files f ON f.id = q.file_id
          WHERE q.space_id = ? AND q.file_id = ?
        `)
        .get(space.id, file.id) as QuarantineRow | undefined;
      if (existing !== undefined) {
        return mapRecord(existing);
      }

      connection
        .prepare(`
          INSERT INTO document_quarantine_records(
            id, space_id, file_id, original_name, media_type, format,
            decision, report_json, created_by, correlation_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          space.id,
          file.id,
          fileName,
          mediaType,
          format,
          decision,
          stringifyJson(report),
          context.actorId,
          context.correlationId,
          context.now
        );

      this.outbox.append(
        {
          eventType: "document.quarantined",
          schemaVersion: 1,
          source: "document-quarantine-registry",
          occurredAt: context.now,
          payload: {
            id,
            spaceId: space.id,
            fileId: file.id,
            sha256: stored.sha256,
            format,
            decision
          },
          dedupeKey: `document.quarantined:${id}:v1`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "quarantine",
          objectType: "document_source",
          objectId: id,
          correlationId: context.correlationId,
          details: {
            spaceId: space.id,
            fileId: file.id,
            sha256: stored.sha256,
            format,
            decision
          }
        },
        connection
      );

      const row = quarantineRow(connection, space.id, id);
      if (row === undefined) {
        throw new Error(`Created quarantine record was not found: ${id}`);
      }
      return mapRecord(row);
    });
  }

  listDocuments(
    spaceIdentity: string,
    options: ListQuarantineDocumentsOptions = {}
  ): QuarantineDocumentRecord[] {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const limit = normalizeLimit(options.limit);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new DocumentQuarantineNotFoundError(`Space was not found: ${identity}`);
      }
      const rows = connection
        .prepare(`
          SELECT q.*, f.sha256, f.size_bytes, f.storage_path
          FROM document_quarantine_records q
          JOIN files f ON f.id = q.file_id
          WHERE q.space_id = ?
          ORDER BY q.created_at DESC, q.id DESC
          LIMIT ?
        `)
        .all(space.id, limit) as unknown as QuarantineRow[];
      return rows.map(mapRecord);
    });
  }

  getDocument(spaceIdentity: string, recordIdValue: string): QuarantineDocumentRecord {
    const identity = requiredText(spaceIdentity, "spaceId", 160);
    const recordId = requiredText(recordIdValue, "recordId", 160);
    return this.store.execute((connection) => {
      const space = connection
        .prepare("SELECT id FROM spaces WHERE id = ? OR key = ?")
        .get(identity, identity.toLowerCase()) as { id: string } | undefined;
      if (space === undefined) {
        throw new DocumentQuarantineNotFoundError(`Space was not found: ${identity}`);
      }
      const row = quarantineRow(connection, space.id, recordId);
      if (row === undefined) {
        throw new DocumentQuarantineNotFoundError(
          `Quarantine document was not found in this space: ${recordId}`
        );
      }
      return mapRecord(row);
    });
  }
}
