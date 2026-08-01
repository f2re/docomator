import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { type SqliteExecutor, SqliteStore } from "./database.js";
import { ContentAddressedObjectStore } from "./object-store.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PREFIX_PATTERN = /^[a-f0-9]{2}$/u;
const DEFAULT_DETAIL_LIMIT = 200;
const MAXIMUM_DETAIL_LIMIT = 1_000;

export type ObjectReconciliationIssueKind =
  | "object_store_missing"
  | "database_invalid_sha256"
  | "database_object_missing"
  | "database_size_mismatch"
  | "database_storage_path_mismatch"
  | "physical_object_unregistered"
  | "physical_checksum_mismatch"
  | "invalid_layout"
  | "non_regular_entry"
  | "incoming_entry"
  | "unreadable_entry";

export interface ObjectReconciliationIssue {
  kind: ObjectReconciliationIssueKind;
  relativePath: string | null;
  fileId: string | null;
  sha256: string | null;
  actualSha256: string | null;
  expectedSizeBytes: number | null;
  actualSizeBytes: number | null;
  message: string;
}

export interface ObjectReconciliationIssueCounts {
  objectStoreMissing: number;
  databaseInvalidSha256: number;
  databaseObjectMissing: number;
  databaseSizeMismatch: number;
  databaseStoragePathMismatch: number;
  physicalObjectUnregistered: number;
  physicalChecksumMismatch: number;
  invalidLayout: number;
  nonRegularEntry: number;
  incomingEntry: number;
  unreadableEntry: number;
}

export interface ObjectReconciliationReport {
  generatedAt: string;
  healthy: boolean;
  objectStorePresent: boolean;
  databaseObjectCount: number;
  databaseObjectBytes: number;
  physicalObjectCount: number;
  physicalObjectBytes: number;
  matchedObjectCount: number;
  issueCount: number;
  detailCount: number;
  omittedDetailCount: number;
  issueCounts: ObjectReconciliationIssueCounts;
  issues: ObjectReconciliationIssue[];
}

export interface ObjectReconciliationOptions {
  maxDetails?: number;
  now?: Date;
}

interface DatabaseFileRow {
  id: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
}

interface DatabaseObject {
  fileId: string;
  sha256: string;
  sizeBytes: number;
  storagePath: string;
  normalizedStoragePath: string | null;
}

interface PhysicalObject {
  sha256: string;
  actualSha256: string;
  sizeBytes: number;
  relativePath: string;
}

export class ObjectReconciliationValidationError extends Error {
  override readonly name = "ObjectReconciliationValidationError";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function normalizeDetailLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_DETAIL_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAXIMUM_DETAIL_LIMIT) {
    throw new ObjectReconciliationValidationError(
      `Количество подробностей должно быть целым числом от 1 до ${MAXIMUM_DETAIL_LIMIT}.`
    );
  }
  return limit;
}

function initialIssueCounts(): ObjectReconciliationIssueCounts {
  return {
    objectStoreMissing: 0,
    databaseInvalidSha256: 0,
    databaseObjectMissing: 0,
    databaseSizeMismatch: 0,
    databaseStoragePathMismatch: 0,
    physicalObjectUnregistered: 0,
    physicalChecksumMismatch: 0,
    invalidLayout: 0,
    nonRegularEntry: 0,
    incomingEntry: 0,
    unreadableEntry: 0
  };
}

function issueCountKey(
  kind: ObjectReconciliationIssueKind
): keyof ObjectReconciliationIssueCounts {
  switch (kind) {
    case "object_store_missing":
      return "objectStoreMissing";
    case "database_invalid_sha256":
      return "databaseInvalidSha256";
    case "database_object_missing":
      return "databaseObjectMissing";
    case "database_size_mismatch":
      return "databaseSizeMismatch";
    case "database_storage_path_mismatch":
      return "databaseStoragePathMismatch";
    case "physical_object_unregistered":
      return "physicalObjectUnregistered";
    case "physical_checksum_mismatch":
      return "physicalChecksumMismatch";
    case "invalid_layout":
      return "invalidLayout";
    case "non_regular_entry":
      return "nonRegularEntry";
    case "incoming_entry":
      return "incomingEntry";
    case "unreadable_entry":
      return "unreadableEntry";
  }
}

class IssueCollector {
  readonly counts = initialIssueCounts();
  readonly issues: ObjectReconciliationIssue[] = [];
  issueCount = 0;

  constructor(private readonly maximumDetails: number) {}

  add(issue: ObjectReconciliationIssue): void {
    this.issueCount += 1;
    const countKey = issueCountKey(issue.kind);
    this.counts[countKey] += 1;
    if (this.issues.length < this.maximumDetails) {
      this.issues.push(issue);
    }
  }
}

function issue(
  kind: ObjectReconciliationIssueKind,
  message: string,
  values: Partial<Omit<ObjectReconciliationIssue, "kind" | "message">> = {}
): ObjectReconciliationIssue {
  return {
    kind,
    relativePath: values.relativePath ?? null,
    fileId: values.fileId ?? null,
    sha256: values.sha256 ?? null,
    actualSha256: values.actualSha256 ?? null,
    expectedSizeBytes: values.expectedSizeBytes ?? null,
    actualSizeBytes: values.actualSizeBytes ?? null,
    message
  };
}

async function hashFile(
  filePath: string
): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    sizeBytes += buffer.byteLength;
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

function canonicalObjectPath(sha256: string): string {
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

function portableRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function normalizedDatabaseStoragePath(
  storagePath: string,
  objectStoreRoot: string
): string | null {
  const trimmed = storagePath.trim();
  if (trimmed.length === 0) return null;
  if (!path.isAbsolute(trimmed)) {
    const portable = portableRelativePath(trimmed);
    if (portable.startsWith("../") || portable === "..") return null;
    return portable;
  }
  const relative = path.relative(objectStoreRoot, trimmed);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    return null;
  }
  return portableRelativePath(relative);
}

function databaseObjects(
  connection: SqliteExecutor,
  objectStoreRoot: string,
  collector: IssueCollector
): DatabaseObject[] {
  const rows = connection
    .prepare(`
      SELECT id, sha256, size_bytes, storage_path
      FROM files
      ORDER BY id
    `)
    .all() as unknown as DatabaseFileRow[];

  return rows.map((row) => {
    const sha256 = String(row.sha256).trim().toLowerCase();
    const sizeBytes = Number(row.size_bytes);
    const storagePath = String(row.storage_path);
    if (!SHA256_PATTERN.test(sha256)) {
      collector.add(
        issue(
          "database_invalid_sha256",
          "Запись files содержит недопустимый SHA-256.",
          { fileId: row.id, sha256 }
        )
      );
    }
    return {
      fileId: row.id,
      sha256,
      sizeBytes,
      storagePath,
      normalizedStoragePath: normalizedDatabaseStoragePath(
        storagePath,
        objectStoreRoot
      )
    };
  });
}

async function readDirectory(
  absolutePath: string,
  relativePath: string,
  collector: IssueCollector
) {
  try {
    return await readdir(absolutePath, { withFileTypes: true });
  } catch (error) {
    collector.add(
      issue(
        "unreadable_entry",
        `Каталог объектного хранилища недоступен: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { relativePath }
      )
    );
    return [];
  }
}

async function regularDirectory(
  absolutePath: string,
  relativePath: string,
  collector: IssueCollector
): Promise<boolean> {
  try {
    const metadata = await lstat(absolutePath);
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) return true;
    collector.add(
      issue(
        "non_regular_entry",
        "В объектном хранилище обнаружена ссылка или объект вместо каталога.",
        { relativePath }
      )
    );
    return false;
  } catch (error) {
    collector.add(
      issue(
        "unreadable_entry",
        `Не удалось проверить каталог: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { relativePath }
      )
    );
    return false;
  }
}

async function inspectIncomingDirectory(
  objectStoreRoot: string,
  collector: IssueCollector
): Promise<void> {
  const incomingPath = path.join(objectStoreRoot, ".incoming");
  try {
    const metadata = await lstat(incomingPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      collector.add(
        issue(
          "non_regular_entry",
          "Служебный путь .incoming не является обычным каталогом.",
          { relativePath: ".incoming" }
        )
      );
      return;
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    collector.add(
      issue(
        "unreadable_entry",
        `Не удалось проверить служебный каталог .incoming: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { relativePath: ".incoming" }
      )
    );
    return;
  }

  const entries = await readDirectory(incomingPath, ".incoming", collector);
  for (const entry of entries) {
    collector.add(
      issue(
        "incoming_entry",
        "Во временном каталоге остался незавершённый объект.",
        { relativePath: `.incoming/${entry.name}` }
      )
    );
  }
}

async function scanPhysicalObjects(
  objectStoreRoot: string,
  collector: IssueCollector
): Promise<{ present: boolean; objects: Map<string, PhysicalObject> }> {
  try {
    const rootMetadata = await lstat(objectStoreRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      collector.add(
        issue(
          "non_regular_entry",
          "Корень объектного хранилища не является обычным каталогом.",
          { relativePath: "." }
        )
      );
      return { present: true, objects: new Map() };
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      collector.add(
        issue(
          "object_store_missing",
          "Каталог объектного хранилища отсутствует.",
          { relativePath: "." }
        )
      );
      return { present: false, objects: new Map() };
    }
    collector.add(
      issue(
        "unreadable_entry",
        `Корень объектного хранилища недоступен: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { relativePath: "." }
      )
    );
    return { present: true, objects: new Map() };
  }

  await inspectIncomingDirectory(objectStoreRoot, collector);
  const objects = new Map<string, PhysicalObject>();
  const firstLevel = await readDirectory(objectStoreRoot, ".", collector);
  for (const firstEntry of firstLevel) {
    if (firstEntry.name === ".incoming") continue;
    const firstRelative = firstEntry.name;
    const firstAbsolute = path.join(objectStoreRoot, firstEntry.name);
    if (!PREFIX_PATTERN.test(firstEntry.name)) {
      collector.add(
        issue(
          "invalid_layout",
          "Объект находится вне двухуровневой SHA-256 структуры.",
          { relativePath: firstRelative }
        )
      );
      continue;
    }
    if (!(await regularDirectory(firstAbsolute, firstRelative, collector))) continue;

    const secondLevel = await readDirectory(firstAbsolute, firstRelative, collector);
    for (const secondEntry of secondLevel) {
      const secondRelative = `${firstEntry.name}/${secondEntry.name}`;
      const secondAbsolute = path.join(firstAbsolute, secondEntry.name);
      if (!PREFIX_PATTERN.test(secondEntry.name)) {
        collector.add(
          issue(
            "invalid_layout",
            "Второй уровень объекта не соответствует SHA-256 структуре.",
            { relativePath: secondRelative }
          )
        );
        continue;
      }
      if (!(await regularDirectory(secondAbsolute, secondRelative, collector))) continue;

      const files = await readDirectory(secondAbsolute, secondRelative, collector);
      for (const fileEntry of files) {
        const relativePath = `${secondRelative}/${fileEntry.name}`;
        const absolutePath = path.join(secondAbsolute, fileEntry.name);
        if (
          !SHA256_PATTERN.test(fileEntry.name) ||
          fileEntry.name.slice(0, 2) !== firstEntry.name ||
          fileEntry.name.slice(2, 4) !== secondEntry.name
        ) {
          collector.add(
            issue(
              "invalid_layout",
              "Имя или расположение объекта не соответствует его SHA-256 пути.",
              { relativePath, sha256: fileEntry.name }
            )
          );
          continue;
        }

        try {
          const metadata = await lstat(absolutePath);
          if (!metadata.isFile() || metadata.isSymbolicLink()) {
            collector.add(
              issue(
                "non_regular_entry",
                "В SHA-256 пути находится ссылка или не обычный файл.",
                { relativePath, sha256: fileEntry.name }
              )
            );
            continue;
          }
          const hashed = await hashFile(absolutePath);
          const physical: PhysicalObject = {
            sha256: fileEntry.name,
            actualSha256: hashed.sha256,
            sizeBytes: hashed.sizeBytes,
            relativePath
          };
          objects.set(fileEntry.name, physical);
          if (hashed.sha256 !== fileEntry.name) {
            collector.add(
              issue(
                "physical_checksum_mismatch",
                "Содержимое объекта не соответствует SHA-256 в имени файла.",
                {
                  relativePath,
                  sha256: fileEntry.name,
                  actualSha256: hashed.sha256,
                  actualSizeBytes: hashed.sizeBytes
                }
              )
            );
          }
        } catch (error) {
          collector.add(
            issue(
              "unreadable_entry",
              `Не удалось прочитать объект: ${
                error instanceof Error ? error.message : String(error)
              }`,
              { relativePath, sha256: fileEntry.name }
            )
          );
        }
      }
    }
  }
  return { present: true, objects };
}

export class ObjectReconciliationRegistry {
  constructor(
    private readonly store: SqliteStore,
    private readonly objectStore: ContentAddressedObjectStore
  ) {}

  async reconcile(
    options: ObjectReconciliationOptions = {}
  ): Promise<ObjectReconciliationReport> {
    const maximumDetails = normalizeDetailLimit(options.maxDetails);
    const now = options.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new ObjectReconciliationValidationError(
        "Время формирования отчёта недействительно."
      );
    }

    const collector = new IssueCollector(maximumDetails);
    const database = this.store.execute((connection) =>
      databaseObjects(connection, this.objectStore.root, collector)
    );
    const databaseBySha256 = new Map(
      database
        .filter((entry) => SHA256_PATTERN.test(entry.sha256))
        .map((entry) => [entry.sha256, entry] as const)
    );
    const physical = await scanPhysicalObjects(this.objectStore.root, collector);

    let databaseObjectBytes = 0;
    let physicalObjectBytes = 0;
    let matchedObjectCount = 0;

    for (const entry of database) {
      databaseObjectBytes += Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : 0;
      if (!SHA256_PATTERN.test(entry.sha256)) continue;
      const expectedPath = canonicalObjectPath(entry.sha256);
      const physicalEntry = physical.objects.get(entry.sha256);
      let exactMatch = true;

      if (entry.normalizedStoragePath !== expectedPath) {
        exactMatch = false;
        collector.add(
          issue(
            "database_storage_path_mismatch",
            "Путь в SQLite не соответствует каноническому SHA-256 расположению.",
            {
              relativePath: entry.normalizedStoragePath ?? entry.storagePath,
              fileId: entry.fileId,
              sha256: entry.sha256
            }
          )
        );
      }

      if (physicalEntry === undefined) {
        collector.add(
          issue(
            "database_object_missing",
            "Для записи files отсутствует физический объект.",
            {
              relativePath: expectedPath,
              fileId: entry.fileId,
              sha256: entry.sha256,
              expectedSizeBytes: entry.sizeBytes
            }
          )
        );
        continue;
      }

      if (physicalEntry.actualSha256 !== entry.sha256) exactMatch = false;
      if (physicalEntry.sizeBytes !== entry.sizeBytes) {
        exactMatch = false;
        collector.add(
          issue(
            "database_size_mismatch",
            "Размер объекта на диске не совпадает с записью files.",
            {
              relativePath: physicalEntry.relativePath,
              fileId: entry.fileId,
              sha256: entry.sha256,
              expectedSizeBytes: entry.sizeBytes,
              actualSizeBytes: physicalEntry.sizeBytes
            }
          )
        );
      }
      if (exactMatch) matchedObjectCount += 1;
    }

    for (const physicalEntry of physical.objects.values()) {
      physicalObjectBytes += physicalEntry.sizeBytes;
      if (!databaseBySha256.has(physicalEntry.sha256)) {
        collector.add(
          issue(
            "physical_object_unregistered",
            "Физический объект отсутствует в таблице files.",
            {
              relativePath: physicalEntry.relativePath,
              sha256: physicalEntry.sha256,
              actualSha256: physicalEntry.actualSha256,
              actualSizeBytes: physicalEntry.sizeBytes
            }
          )
        );
      }
    }

    return {
      generatedAt: now.toISOString(),
      healthy: collector.issueCount === 0,
      objectStorePresent: physical.present,
      databaseObjectCount: database.length,
      databaseObjectBytes,
      physicalObjectCount: physical.objects.size,
      physicalObjectBytes,
      matchedObjectCount,
      issueCount: collector.issueCount,
      detailCount: collector.issues.length,
      omittedDetailCount: collector.issueCount - collector.issues.length,
      issueCounts: collector.counts,
      issues: collector.issues
    };
  }
}
