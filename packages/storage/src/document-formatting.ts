import { createHash, randomUUID } from "node:crypto";

import { type SqliteExecutor, SqliteStore } from "./database.js";
import { parseJson, stringifyJson, toJsonValue, type JsonValue } from "./json.js";
import { KnowledgeConflictError, KnowledgeNotFoundError, KnowledgeValidationError, type MutationContext } from "./knowledge.js";
import type { StoredObject } from "./object-store.js";
import { WorkerQueue, type WorkerJobState } from "./queue.js";

export type DocumentFormattingItemState = "pending" | "running" | "completed" | "failed";

export interface DocumentFormattingSource {
  itemId: string;
  sourceRecordId: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  state: DocumentFormattingItemState;
}

export interface DocumentFormattingItem extends DocumentFormattingSource {
  outputFileId: string | null;
  outputName: string | null;
  outputSha256: string | null;
  outputSizeBytes: number | null;
  analysis: JsonValue | null;
  error: JsonValue | null;
  updatedAt: string;
}

export interface DocumentFormattingJob {
  id: string;
  spaceId: string;
  state: WorkerJobState;
  settings: JsonValue;
  items: DocumentFormattingItem[];
  attempts: number;
  maxAttempts: number;
  lastError: JsonValue | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface JobRow {
  id: string;
  state: WorkerJobState;
  payload_json: string;
  attempts: number;
  max_attempts: number;
  last_error_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ItemRow {
  id: string;
  worker_job_id: string;
  space_id: string;
  source_record_id: string;
  original_name: string;
  source_sha256: string;
  source_size_bytes: number;
  state: DocumentFormattingItemState;
  output_file_id: string | null;
  output_name: string | null;
  output_sha256: string | null;
  output_size_bytes: number | null;
  analysis_json: string | null;
  error_json: string | null;
  updated_at: string;
}

export class DocumentFormattingValidationError extends KnowledgeValidationError {
  override readonly name = "DocumentFormattingValidationError";
}
export class DocumentFormattingNotFoundError extends KnowledgeNotFoundError {
  override readonly name = "DocumentFormattingNotFoundError";
}
export class DocumentFormattingConflictError extends KnowledgeConflictError {
  override readonly name = "DocumentFormattingConflictError";
}

function required(value: string, name: string, max = 160): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) throw new DocumentFormattingValidationError(`${name} is invalid`);
  return normalized;
}

function nowIso(context: MutationContext): string {
  const value = context.now === undefined ? new Date() : context.now instanceof Date ? context.now : new Date(context.now);
  if (Number.isNaN(value.getTime())) throw new DocumentFormattingValidationError("Invalid mutation timestamp");
  return value.toISOString();
}

function mapItem(row: ItemRow): DocumentFormattingItem {
  return {
    itemId: row.id,
    sourceRecordId: row.source_record_id,
    fileName: row.original_name,
    sha256: row.source_sha256,
    sizeBytes: Number(row.source_size_bytes),
    state: row.state,
    outputFileId: row.output_file_id,
    outputName: row.output_name,
    outputSha256: row.output_sha256,
    outputSizeBytes: row.output_size_bytes === null ? null : Number(row.output_size_bytes),
    analysis: row.analysis_json === null ? null : parseJson(row.analysis_json),
    error: row.error_json === null ? null : parseJson(row.error_json),
    updatedAt: row.updated_at
  };
}

function resolveSpace(connection: SqliteExecutor, identity: string): string {
  const row = connection.prepare("SELECT id FROM spaces WHERE id = ? OR key = ?").get(identity, identity.toLowerCase()) as { id: string } | undefined;
  if (!row) throw new DocumentFormattingNotFoundError(`Space was not found: ${identity}`);
  return row.id;
}

function itemRows(connection: SqliteExecutor, spaceId: string, jobId: string): ItemRow[] {
  return connection.prepare(`
    SELECT i.*, ofile.sha256 AS output_sha256, ofile.size_bytes AS output_size_bytes
    FROM document_formatting_items i
    LEFT JOIN files ofile ON ofile.id = i.output_file_id
    WHERE i.space_id = ? AND i.worker_job_id = ?
    ORDER BY i.created_at, i.id
  `).all(spaceId, jobId) as unknown as ItemRow[];
}

export class DocumentFormattingRegistry {
  private readonly queue: WorkerQueue;
  constructor(private readonly store: SqliteStore, queue?: WorkerQueue) {
    this.queue = queue ?? new WorkerQueue(store);
  }

  createJob(
    input: { spaceId: string; sourceRecordIds: string[]; settings: JsonValue; retryOfJobId?: string },
    context: MutationContext
  ): DocumentFormattingJob {
    const identity = required(input.spaceId, "spaceId");
    const sourceIds = [...new Set(input.sourceRecordIds.map((value) => required(value, "sourceRecordId")))];
    if (sourceIds.length < 1 || sourceIds.length > 100) {
      throw new DocumentFormattingValidationError("sourceRecordIds must contain 1..100 unique records");
    }
    const settings = toJsonValue(input.settings);
    const now = nowIso(context);
    const actorId = context.actorId === undefined || context.actorId === null ? null : required(context.actorId, "actorId");
    const correlationId = required(context.correlationId, "correlationId");

    const jobId = this.store.transaction((connection) => {
      const spaceId = resolveSpace(connection, identity);
      const placeholders = sourceIds.map(() => "?").join(", ");
      const rows = connection.prepare(`
        SELECT q.id, q.original_name, q.format, f.sha256, f.size_bytes
        FROM document_quarantine_records q
        JOIN files f ON f.id = q.file_id
        WHERE q.space_id = ? AND q.id IN (${placeholders})
      `).all(spaceId, ...sourceIds) as unknown as Array<{ id: string; original_name: string; format: string; sha256: string; size_bytes: number }>;
      if (rows.length !== sourceIds.length) {
        throw new DocumentFormattingNotFoundError("Один или несколько исходных документов не найдены в текущем пространстве.");
      }
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (const id of sourceIds) {
        if (byId.get(id)?.format !== "docx") throw new DocumentFormattingValidationError("Форматирование по ГОСТ/ЕСКД поддерживает только DOCX.");
      }
      const sourceDigest = sourceIds.map((id) => `${id}:${byId.get(id)?.sha256 ?? ""}`).join("\n");
      const retryScope = input.retryOfJobId === undefined ? "initial" : `retry:${required(input.retryOfJobId, "retryOfJobId")}`;
      const idempotencyKey = `document-format:${spaceId}:${retryScope}:${createHash("sha256").update(`${sourceDigest}\n${stringifyJson(settings)}`).digest("hex")}`;
      const queued = this.queue.enqueue({
        jobType: "document.format-standard",
        payload: toJsonValue({ spaceId, settings }),
        idempotencyKey,
        maxAttempts: 3,
        now
      }, connection);
      if (queued.created) {
        for (const id of sourceIds) {
          const source = byId.get(id)!;
          connection.prepare(`
            INSERT INTO document_formatting_items(
              id, worker_job_id, space_id, source_record_id, original_name,
              source_sha256, source_size_bytes, state, output_file_id,
              output_name, analysis_json, error_json, created_by,
              correlation_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, ?, ?, ?)
          `).run(randomUUID(), queued.job.id, spaceId, id, source.original_name, source.sha256, source.size_bytes, actorId, correlationId, now, now);
        }
      }
      return queued.job.id;
    });
    return this.getJob(identity, jobId);
  }

  getJob(spaceIdentity: string, jobIdValue: string): DocumentFormattingJob {
    const identity = required(spaceIdentity, "spaceId");
    const jobId = required(jobIdValue, "jobId");
    return this.store.execute((connection) => {
      const spaceId = resolveSpace(connection, identity);
      const row = connection.prepare(`
        SELECT w.* FROM worker_jobs w
        WHERE w.id = ? AND w.job_type = 'document.format-standard'
          AND EXISTS (SELECT 1 FROM document_formatting_items i WHERE i.worker_job_id = w.id AND i.space_id = ?)
      `).get(jobId, spaceId) as JobRow | undefined;
      if (!row) throw new DocumentFormattingNotFoundError(`Formatting job was not found: ${jobId}`);
      const payload = parseJson(row.payload_json);
      const settings = payload !== null && !Array.isArray(payload) && typeof payload === "object" && "settings" in payload ? payload.settings : null;
      return {
        id: row.id,
        spaceId,
        state: row.state,
        settings,
        items: itemRows(connection, spaceId, jobId).map(mapItem),
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        lastError: row.last_error_json === null ? null : parseJson(row.last_error_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at
      };
    });
  }

  listJobs(spaceIdentity: string, limit = 30): DocumentFormattingJob[] {
    const identity = required(spaceIdentity, "spaceId");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DocumentFormattingValidationError("limit must be 1..100");
    return this.store.execute((connection) => {
      const spaceId = resolveSpace(connection, identity);
      const rows = connection.prepare(`
        SELECT DISTINCT w.* FROM worker_jobs w
        JOIN document_formatting_items i ON i.worker_job_id = w.id
        WHERE w.job_type = 'document.format-standard' AND i.space_id = ?
        ORDER BY w.created_at DESC, w.id DESC LIMIT ?
      `).all(spaceId, limit) as unknown as JobRow[];
      return rows.map((row) => {
        const payload = parseJson(row.payload_json);
        const settings = payload !== null && !Array.isArray(payload) && typeof payload === "object" && "settings" in payload ? payload.settings : null;
        return {
          id: row.id, spaceId, state: row.state, settings,
          items: itemRows(connection, spaceId, row.id).map(mapItem), attempts: row.attempts,
          maxAttempts: row.max_attempts, lastError: row.last_error_json === null ? null : parseJson(row.last_error_json),
          createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at
        };
      });
    });
  }

  listWorkItems(spaceIdentity: string, jobIdValue: string): DocumentFormattingSource[] {
    const identity = required(spaceIdentity, "spaceId");
    const jobId = required(jobIdValue, "jobId");
    return this.store.execute((connection) => {
      const spaceId = resolveSpace(connection, identity);
      const rows = itemRows(connection, spaceId, jobId);
      if (rows.length === 0) throw new DocumentFormattingNotFoundError(`Formatting job was not found: ${jobId}`);
      return rows.filter((row) => row.state !== "completed").map((row) => ({
        itemId: row.id, sourceRecordId: row.source_record_id, fileName: row.original_name,
        sha256: row.source_sha256, sizeBytes: Number(row.source_size_bytes), state: row.state
      }));
    });
  }

  markRunning(spaceIdentity: string, jobIdValue: string, itemIdValue: string): void {
    this.updateItem(spaceIdentity, jobIdValue, itemIdValue, (connection, spaceId, jobId, itemId, now) => {
      const result = connection.prepare(`UPDATE document_formatting_items SET state='running', error_json=NULL, updated_at=? WHERE id=? AND worker_job_id=? AND space_id=? AND state IN ('pending','failed','running')`).run(now, itemId, jobId, spaceId);
      if (result.changes !== 1) throw new DocumentFormattingConflictError("Formatting item cannot be started from its current state.");
    });
  }

  completeItem(
    spaceIdentity: string,
    jobIdValue: string,
    itemIdValue: string,
    output: StoredObject,
    outputNameValue: string,
    analysis: JsonValue
  ): void {
    const outputName = required(outputNameValue, "outputName", 255);
    this.updateItem(spaceIdentity, jobIdValue, itemIdValue, (connection, spaceId, jobId, itemId, now) => {
      let file = connection.prepare("SELECT id FROM files WHERE sha256 = ?").get(output.sha256) as { id: string } | undefined;
      if (!file) {
        file = { id: randomUUID() };
        connection.prepare(`INSERT INTO files(id, sha256, original_name, media_type, size_bytes, storage_path, created_at, created_by) VALUES (?, ?, ?, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ?, ?, ?, 'document-formatting-worker')`).run(file.id, output.sha256, outputName, output.sizeBytes, output.relativePath, now);
      }
      const result = connection.prepare(`UPDATE document_formatting_items SET state='completed', output_file_id=?, output_name=?, analysis_json=?, error_json=NULL, updated_at=? WHERE id=? AND worker_job_id=? AND space_id=?`).run(file.id, outputName, stringifyJson(toJsonValue(analysis)), now, itemId, jobId, spaceId);
      if (result.changes !== 1) throw new DocumentFormattingNotFoundError(`Formatting item was not found: ${itemId}`);
    });
  }

  failItem(spaceIdentity: string, jobIdValue: string, itemIdValue: string, error: JsonValue): void {
    this.updateItem(spaceIdentity, jobIdValue, itemIdValue, (connection, spaceId, jobId, itemId, now) => {
      const result = connection.prepare(`UPDATE document_formatting_items SET state='failed', error_json=?, updated_at=? WHERE id=? AND worker_job_id=? AND space_id=?`).run(stringifyJson(toJsonValue(error)), now, itemId, jobId, spaceId);
      if (result.changes !== 1) throw new DocumentFormattingNotFoundError(`Formatting item was not found: ${itemId}`);
    });
  }

  getOutput(spaceIdentity: string, jobIdValue: string, itemIdValue: string): { sha256: string; fileName: string } {
    const identity = required(spaceIdentity, "spaceId");
    const jobId = required(jobIdValue, "jobId");
    const itemId = required(itemIdValue, "itemId");
    return this.store.execute((connection) => {
      const spaceId = resolveSpace(connection, identity);
      const row = connection.prepare(`SELECT f.sha256, i.output_name FROM document_formatting_items i JOIN files f ON f.id=i.output_file_id WHERE i.id=? AND i.worker_job_id=? AND i.space_id=? AND i.state='completed'`).get(itemId, jobId, spaceId) as { sha256: string; output_name: string } | undefined;
      if (!row) throw new DocumentFormattingNotFoundError("Готовый файл не найден или ещё не создан.");
      return { sha256: row.sha256, fileName: row.output_name };
    });
  }

  private updateItem(
    spaceIdentity: string, jobIdValue: string, itemIdValue: string,
    apply: (connection: SqliteExecutor, spaceId: string, jobId: string, itemId: string, now: string) => void
  ): void {
    const identity = required(spaceIdentity, "spaceId");
    const jobId = required(jobIdValue, "jobId");
    const itemId = required(itemIdValue, "itemId");
    this.store.transaction((connection) => apply(connection, resolveSpace(connection, identity), jobId, itemId, new Date().toISOString()));
  }
}
