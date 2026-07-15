import { createHash } from "node:crypto";

import { AuditRepository } from "./audit.js";
import { type SqliteExecutor, SqliteStore } from "./database.js";
import type { MutationContext } from "./knowledge.js";
import { ContentAddressedObjectStore } from "./object-store.js";

export interface ObjectCleanupCandidate {
  fileId: string;
  sha256: string;
  sizeBytes: number;
  storagePath: string;
  createdAt: string;
}

export interface ObjectCleanupPlan {
  cutoff: string;
  candidateCount: number;
  candidateBytes: number;
  confirmationToken: string;
  candidates: ObjectCleanupCandidate[];
}

export interface ObjectStorageUsage {
  objectCount: number;
  objectBytes: number;
  referencedCount: number;
  referencedBytes: number;
  cleanupCandidateCount: number;
  cleanupCandidateBytes: number;
  cutoff: string;
}

export interface ObjectCleanupResult {
  cutoff: string;
  plannedCount: number;
  deletedCount: number;
  deletedBytes: number;
  missingCount: number;
  failedCount: number;
  failures: Array<{ sha256: string; message: string }>;
}

interface FileRow {
  id: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

interface TableRow {
  name: string;
}

interface ForeignKeyRow {
  table: string;
  from: string;
  to: string;
}

interface ColumnRow {
  name: string;
}

export class ObjectCleanupValidationError extends Error {
  override readonly name = "ObjectCleanupValidationError";
}

export class ObjectCleanupConflictError extends Error {
  override readonly name = "ObjectCleanupConflictError";
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeCutoff(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() >= Date.now()) {
    throw new ObjectCleanupValidationError(
      "Граница возраста объектов должна быть корректной датой в прошлом."
    );
  }
  return date.toISOString();
}

export function cleanupCutoffFromDays(
  minimumAgeDaysValue: number,
  nowValue: Date = new Date()
): string {
  if (
    !Number.isInteger(minimumAgeDaysValue) ||
    minimumAgeDaysValue < 1 ||
    minimumAgeDaysValue > 3_650
  ) {
    throw new ObjectCleanupValidationError(
      "Минимальный возраст должен быть целым числом от 1 до 3650 дней."
    );
  }
  return new Date(
    nowValue.getTime() - minimumAgeDaysValue * 24 * 60 * 60 * 1_000
  ).toISOString();
}

function databaseTables(connection: SqliteExecutor): string[] {
  return (
    connection
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)
      .all() as unknown as TableRow[]
  ).map((row) => row.name);
}

function valuesFromColumn(
  connection: SqliteExecutor,
  table: string,
  column: string
): string[] {
  const tableSql = quoteIdentifier(table);
  const columnSql = quoteIdentifier(column);
  return (
    connection
      .prepare(`
        SELECT DISTINCT ${columnSql} AS value
        FROM ${tableSql}
        WHERE ${columnSql} IS NOT NULL
      `)
      .all() as unknown as Array<{ value: string | null }>
  )
    .map((row) => row.value)
    .filter((value): value is string => typeof value === "string");
}

function liveReferences(connection: SqliteExecutor): {
  fileIds: Set<string>;
  sha256: Set<string>;
} {
  const fileIds = new Set<string>();
  const sha256 = new Set<string>();
  const auditOnlyShaTables = new Set([
    "document_deliveries",
    "document_email_deliveries"
  ]);

  for (const table of databaseTables(connection)) {
    if (table !== "files") {
      const foreignKeys = connection
        .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)
        .all() as unknown as ForeignKeyRow[];
      for (const foreignKey of foreignKeys) {
        if (foreignKey.table === "files" && foreignKey.to === "id") {
          for (const value of valuesFromColumn(connection, table, foreignKey.from)) {
            fileIds.add(value);
          }
        }
      }
    }

    if (table === "files" || auditOnlyShaTables.has(table)) continue;
    const columns = connection
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all() as unknown as ColumnRow[];
    for (const column of columns) {
      if (!column.name.toLowerCase().includes("sha256")) continue;
      for (const value of valuesFromColumn(connection, table, column.name)) {
        const normalized = value.trim().toLowerCase();
        if (/^[a-f0-9]{64}$/u.test(normalized)) sha256.add(normalized);
      }
    }
  }
  return { fileIds, sha256 };
}

function candidatesForCutoff(
  connection: SqliteExecutor,
  cutoff: string
): ObjectCleanupCandidate[] {
  const live = liveReferences(connection);
  const rows = connection
    .prepare(`
      SELECT id, sha256, size_bytes, storage_path, created_at
      FROM files
      WHERE created_at < ?
      ORDER BY created_at ASC, id ASC
    `)
    .all(cutoff) as unknown as FileRow[];
  return rows
    .filter(
      (row) => !live.fileIds.has(row.id) && !live.sha256.has(row.sha256.toLowerCase())
    )
    .map((row) => ({
      fileId: row.id,
      sha256: row.sha256.toLowerCase(),
      sizeBytes: Number(row.size_bytes),
      storagePath: row.storage_path,
      createdAt: row.created_at
    }));
}

function planToken(cutoff: string, candidates: readonly ObjectCleanupCandidate[]): string {
  const hash = createHash("sha256");
  hash.update(cutoff);
  for (const candidate of candidates) {
    hash.update("\n");
    hash.update(candidate.fileId);
    hash.update(":");
    hash.update(candidate.sha256);
    hash.update(":");
    hash.update(String(candidate.sizeBytes));
  }
  return hash.digest("hex");
}

function createPlan(
  connection: SqliteExecutor,
  cutoffValue: string | Date
): ObjectCleanupPlan {
  const cutoff = normalizeCutoff(cutoffValue);
  const candidates = candidatesForCutoff(connection, cutoff);
  return {
    cutoff,
    candidateCount: candidates.length,
    candidateBytes: candidates.reduce(
      (total, candidate) => total + candidate.sizeBytes,
      0
    ),
    confirmationToken: planToken(cutoff, candidates),
    candidates: candidates.slice(0, 200)
  };
}

export class ObjectCleanupRegistry {
  private readonly audit: AuditRepository;

  constructor(
    private readonly store: SqliteStore,
    private readonly objectStore: ContentAddressedObjectStore,
    options: { audit?: AuditRepository } = {}
  ) {
    this.audit = options.audit ?? new AuditRepository(store);
  }

  usage(minimumAgeDays = 7, now: Date = new Date()): ObjectStorageUsage {
    const cutoff = cleanupCutoffFromDays(minimumAgeDays, now);
    return this.store.execute((connection) => {
      const totals = connection
        .prepare(`
          SELECT COUNT(*) AS object_count,
                 COALESCE(SUM(size_bytes), 0) AS object_bytes
          FROM files
        `)
        .get() as { object_count: number; object_bytes: number };
      const plan = createPlan(connection, cutoff);
      return {
        objectCount: Number(totals.object_count),
        objectBytes: Number(totals.object_bytes),
        referencedCount: Number(totals.object_count) - plan.candidateCount,
        referencedBytes: Number(totals.object_bytes) - plan.candidateBytes,
        cleanupCandidateCount: plan.candidateCount,
        cleanupCandidateBytes: plan.candidateBytes,
        cutoff
      };
    });
  }

  preview(cutoffValue: string | Date): ObjectCleanupPlan {
    return this.store.execute((connection) => createPlan(connection, cutoffValue));
  }

  async execute(
    cutoffValue: string | Date,
    confirmationTokenValue: string,
    context: MutationContext
  ): Promise<ObjectCleanupResult> {
    const cutoff = normalizeCutoff(cutoffValue);
    const confirmationToken = confirmationTokenValue.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(confirmationToken)) {
      throw new ObjectCleanupValidationError(
        "Контрольный токен плана очистки недействителен."
      );
    }
    const plan = this.preview(cutoff);
    if (plan.confirmationToken !== confirmationToken) {
      throw new ObjectCleanupConflictError(
        "Состав объектов изменился. Выполните предварительный расчёт очистки ещё раз."
      );
    }

    let deletedCount = 0;
    let deletedBytes = 0;
    let missingCount = 0;
    const failures: Array<{ sha256: string; message: string }> = [];

    for (const candidate of plan.candidates) {
      try {
        const deleted = await this.objectStore.deleteObject(candidate.sha256);
        if (deleted) {
          deletedCount += 1;
          deletedBytes += candidate.sizeBytes;
        } else {
          missingCount += 1;
        }
        this.store.transaction((connection) => {
          connection
            .prepare("DELETE FROM files WHERE id = ? AND sha256 = ?")
            .run(candidate.fileId, candidate.sha256);
        });
      } catch (error) {
        failures.push({
          sha256: candidate.sha256,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const result: ObjectCleanupResult = {
      cutoff,
      plannedCount: plan.candidateCount,
      deletedCount,
      deletedBytes,
      missingCount,
      failedCount: failures.length,
      failures: failures.slice(0, 50)
    };

    this.store.transaction((connection) => {
      this.audit.record(
        {
          occurredAt:
            context.now instanceof Date
              ? context.now.toISOString()
              : context.now ?? new Date().toISOString(),
          actorType: context.actorType,
          actorId: context.actorId ?? null,
          action: "cleanup_unreferenced_objects",
          objectType: "object_store",
          objectId: "shared",
          correlationId: context.correlationId,
          details: {
            cutoff,
            plannedCount: plan.candidateCount,
            deletedCount,
            deletedBytes,
            missingCount,
            failedCount: failures.length
          }
        },
        connection
      );
    });

    return result;
  }
}
