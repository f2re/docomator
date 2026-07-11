import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const BACKUP_FORMAT = "docomator-backup";
const BACKUP_VERSION = 1;

function safeTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sqlString(value) {
  if (value.includes("\0")) {
    throw new Error("SQLite path contains a NUL byte");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function assertSafeRelative(relativePath) {
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Unsafe backup path: ${relativePath}`);
  }
  return normalized;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    for await (const chunk of handle.readableWebStream()) {
      hash.update(Buffer.from(chunk));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function listRegularFiles(rootDirectory) {
  if (!(await pathExists(rootDirectory))) {
    return [];
  }

  const files = [];
  async function walk(currentDirectory, relativeDirectory) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const source = path.join(currentDirectory, entry.name);
      const relative = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed in backup input: ${source}`);
      }
      if (entry.isDirectory()) {
        await walk(source, relative);
      } else if (entry.isFile()) {
        files.push(relative);
      } else {
        throw new Error(`Unsupported filesystem entry in backup input: ${source}`);
      }
    }
  }

  await walk(rootDirectory, "");
  return files;
}

async function copyTree(sourceRoot, destinationRoot) {
  await fs.mkdir(destinationRoot, { recursive: true, mode: 0o750 });
  const files = await listRegularFiles(sourceRoot);
  for (const relativePath of files) {
    const source = path.join(sourceRoot, relativePath);
    const destination = path.join(destinationRoot, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
    await fs.copyFile(source, destination);
    const sourceStat = await fs.stat(source);
    await fs.chmod(destination, sourceStat.mode & 0o777);
  }
  return files.length;
}

function verifyDatabase(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").all();
    if (
      integrity.length !== 1 ||
      Object.values(integrity[0] ?? {})[0] !== "ok"
    ) {
      throw new Error(`SQLite integrity_check failed: ${JSON.stringify(integrity)}`);
    }
    const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length > 0) {
      throw new Error(
        `SQLite foreign_key_check failed: ${JSON.stringify(foreignKeyErrors)}`
      );
    }
  } finally {
    database.close();
  }
}

async function writeChecksumManifest(backupDirectory) {
  const relativeFiles = (await listRegularFiles(backupDirectory))
    .filter((relativePath) => relativePath !== "manifest.sha256")
    .sort();
  const lines = [];
  for (const relativePath of relativeFiles) {
    const checksum = await sha256File(path.join(backupDirectory, relativePath));
    lines.push(`${checksum}  ${relativePath}`);
  }
  await fs.writeFile(
    path.join(backupDirectory, "manifest.sha256"),
    `${lines.join("\n")}\n`,
    { encoding: "utf8", mode: 0o640 }
  );
}

async function applyRetention(parentDirectory, prefix, keep, protectedPath) {
  if (keep <= 0) {
    return;
  }
  const entries = await fs.readdir(parentDirectory, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${prefix}-`))
    .map((entry) => path.join(parentDirectory, entry.name))
    .filter((candidate) => path.resolve(candidate) !== path.resolve(protectedPath))
    .sort()
    .reverse();

  for (const candidate of candidates.slice(Math.max(0, keep - 1))) {
    await fs.rm(candidate, { recursive: true, force: true });
  }
}

export async function createBackup(options) {
  const dataDirectory = path.resolve(options.dataDirectory);
  const databasePath = path.resolve(
    options.databasePath ?? path.join(dataDirectory, "docomator.db")
  );
  const objectDirectory = path.resolve(
    options.objectDirectory ?? path.join(dataDirectory, "objects")
  );
  const now = options.now ?? new Date();
  const prefix = options.prefix ?? "backup";
  const outputParent = path.resolve(
    options.outputParent ?? path.join(dataDirectory, "backups")
  );
  const finalDirectory = path.resolve(
    options.outputDirectory ?? path.join(outputParent, `${prefix}-${safeTimestamp(now)}`)
  );

  if (!(await pathExists(databasePath))) {
    throw new Error(`Database does not exist: ${databasePath}`);
  }
  if (
    finalDirectory === objectDirectory ||
    finalDirectory.startsWith(`${objectDirectory}${path.sep}`)
  ) {
    throw new Error("Backup destination must not be inside object storage");
  }
  if (await pathExists(finalDirectory)) {
    throw new Error(`Backup destination already exists: ${finalDirectory}`);
  }

  await fs.mkdir(path.dirname(finalDirectory), { recursive: true, mode: 0o750 });
  const temporaryDirectory = path.join(
    path.dirname(finalDirectory),
    `.${path.basename(finalDirectory)}.tmp-${crypto.randomUUID()}`
  );
  await fs.mkdir(temporaryDirectory, { mode: 0o750 });

  try {
    const backupDatabaseDirectory = path.join(temporaryDirectory, "database");
    const backupDatabasePath = path.join(backupDatabaseDirectory, "docomator.db");
    await fs.mkdir(backupDatabaseDirectory, { recursive: true, mode: 0o750 });

    const sourceDatabase = new DatabaseSync(databasePath);
    try {
      sourceDatabase.exec("PRAGMA foreign_keys = ON;");
      sourceDatabase.exec("PRAGMA busy_timeout = 5000;");
      sourceDatabase.exec(`VACUUM INTO ${sqlString(backupDatabasePath)};`);
    } finally {
      sourceDatabase.close();
    }
    verifyDatabase(backupDatabasePath);

    const objectCount = await copyTree(
      objectDirectory,
      path.join(temporaryDirectory, "objects")
    );

    let configIncluded = false;
    if (options.configFile !== undefined) {
      const configFile = path.resolve(options.configFile);
      if (await pathExists(configFile)) {
        await fs.mkdir(path.join(temporaryDirectory, "config"), {
          recursive: true,
          mode: 0o750
        });
        await fs.copyFile(
          configFile,
          path.join(temporaryDirectory, "config", "docomator.env")
        );
        await fs.chmod(
          path.join(temporaryDirectory, "config", "docomator.env"),
          0o640
        );
        configIncluded = true;
      }
    }

    const databaseStat = await fs.stat(backupDatabasePath);
    const manifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: now.toISOString(),
      releaseVersion: options.releaseVersion ?? null,
      source: {
        dataDirectory,
        databaseFile: path.basename(databasePath)
      },
      database: {
        path: "database/docomator.db",
        sizeBytes: databaseStat.size,
        sha256: await sha256File(backupDatabasePath)
      },
      objects: {
        path: "objects",
        count: objectCount
      },
      config: configIncluded ? { path: "config/docomator.env" } : null
    };

    await fs.writeFile(
      path.join(temporaryDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o640 }
    );
    await writeChecksumManifest(temporaryDirectory);
    await fs.rename(temporaryDirectory, finalDirectory);
    await applyRetention(
      path.dirname(finalDirectory),
      prefix,
      options.retentionCount ?? 0,
      finalDirectory
    );
    return { directory: finalDirectory, manifest };
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyBackup(backupDirectoryInput) {
  const backupDirectory = path.resolve(backupDirectoryInput);
  const manifestPath = path.join(backupDirectory, "manifest.json");
  const checksumPath = path.join(backupDirectory, "manifest.sha256");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION) {
    throw new Error("Unsupported Docomator backup format or version");
  }

  const checksumText = await fs.readFile(checksumPath, "utf8");
  const lines = checksumText.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    throw new Error("Backup checksum manifest is empty");
  }
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (match === null) {
      throw new Error(`Invalid checksum manifest line: ${line}`);
    }
    const expected = match[1];
    const relativePath = assertSafeRelative(match[2]);
    const target = path.resolve(backupDirectory, relativePath);
    if (!target.startsWith(`${backupDirectory}${path.sep}`)) {
      throw new Error(`Backup path escapes root: ${relativePath}`);
    }
    const actual = await sha256File(target);
    if (actual !== expected) {
      throw new Error(`Backup checksum mismatch: ${relativePath}`);
    }
  }

  const databasePath = path.join(backupDirectory, "database", "docomator.db");
  verifyDatabase(databasePath);
  const databaseChecksum = await sha256File(databasePath);
  if (databaseChecksum !== manifest.database.sha256) {
    throw new Error("Backup database checksum does not match manifest.json");
  }
  return manifest;
}

async function acquireRestoreLock(dataDirectory) {
  await fs.mkdir(dataDirectory, { recursive: true, mode: 0o750 });
  const lockPath = path.join(dataDirectory, ".restore.lock");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      return {
        async release() {
          await handle.close();
          await fs.rm(lockPath, { force: true });
        }
      };
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "EEXIST")) {
        throw error;
      }
      const owner = Number.parseInt(await fs.readFile(lockPath, "utf8").catch(() => ""), 10);
      const ownerAlive = Number.isInteger(owner) && await pathExists(`/proc/${owner}`);
      if (ownerAlive || attempt > 0) {
        throw new Error(`Restore lock already exists: ${lockPath}`);
      }
      await fs.rm(lockPath, { force: true });
    }
  }
  throw new Error(`Unable to acquire restore lock: ${lockPath}`);
}

export async function restoreBackup(options) {
  const backupDirectory = path.resolve(options.backupDirectory);
  const dataDirectory = path.resolve(options.dataDirectory);
  const manifest = await verifyBackup(backupDirectory);
  const lock = await acquireRestoreLock(dataDirectory);
  const operationId = crypto.randomUUID();
  const stageDirectory = path.join(dataDirectory, `.restore-stage-${operationId}`);
  const rollbackDirectory = path.join(dataDirectory, `.restore-rollback-${operationId}`);
  const databasePath = path.join(dataDirectory, "docomator.db");
  const objectsPath = path.join(dataDirectory, "objects");
  const restoredDatabasePath = path.join(stageDirectory, "docomator.db");
  const restoredObjectsPath = path.join(stageDirectory, "objects");
  let databaseMoved = false;
  let objectsMoved = false;
  let newDatabaseInstalled = false;
  let newObjectsInstalled = false;
  let configRollbackPath;
  let configInstalled = false;

  await fs.mkdir(stageDirectory, { recursive: true, mode: 0o750 });
  await fs.mkdir(rollbackDirectory, { recursive: true, mode: 0o750 });

  try {
    await fs.copyFile(
      path.join(backupDirectory, "database", "docomator.db"),
      restoredDatabasePath
    );
    await copyTree(path.join(backupDirectory, "objects"), restoredObjectsPath);
    verifyDatabase(restoredDatabasePath);

    for (const suffix of ["-wal", "-shm"]) {
      await fs.rm(`${databasePath}${suffix}`, { force: true });
    }
    if (await pathExists(databasePath)) {
      await fs.rename(databasePath, path.join(rollbackDirectory, "docomator.db"));
      databaseMoved = true;
    }
    if (await pathExists(objectsPath)) {
      await fs.rename(objectsPath, path.join(rollbackDirectory, "objects"));
      objectsMoved = true;
    }

    await fs.rename(restoredDatabasePath, databasePath);
    newDatabaseInstalled = true;
    await fs.rename(restoredObjectsPath, objectsPath);
    newObjectsInstalled = true;

    if (options.configFile !== undefined && manifest.config !== null) {
      const configFile = path.resolve(options.configFile);
      await fs.mkdir(path.dirname(configFile), { recursive: true, mode: 0o750 });
      const configTemporaryPath = `${configFile}.restore-${operationId}.tmp`;
      configRollbackPath = `${configFile}.restore-${operationId}.rollback`;
      await fs.copyFile(
        path.join(backupDirectory, "config", "docomator.env"),
        configTemporaryPath
      );
      await fs.chmod(configTemporaryPath, 0o640);
      if (await pathExists(configFile)) {
        await fs.copyFile(configFile, configRollbackPath);
      }
      await fs.rename(configTemporaryPath, configFile);
      configInstalled = true;
    }

    verifyDatabase(databasePath);
    await fs.rm(rollbackDirectory, { recursive: true, force: true });
    await fs.rm(stageDirectory, { recursive: true, force: true });
    if (configRollbackPath !== undefined) {
      await fs.rm(configRollbackPath, { force: true });
    }
    return { manifest, dataDirectory };
  } catch (error) {
    if (newDatabaseInstalled) {
      await fs.rm(databasePath, { force: true });
    }
    if (databaseMoved) {
      await fs.rename(path.join(rollbackDirectory, "docomator.db"), databasePath);
    }
    if (newObjectsInstalled) {
      await fs.rm(objectsPath, { recursive: true, force: true });
    }
    if (objectsMoved) {
      await fs.rename(path.join(rollbackDirectory, "objects"), objectsPath);
    }
    if (configInstalled && options.configFile !== undefined) {
      const configFile = path.resolve(options.configFile);
      await fs.rm(configFile, { force: true });
      if (configRollbackPath !== undefined && (await pathExists(configRollbackPath))) {
        await fs.rename(configRollbackPath, configFile);
      }
    }
    await fs.rm(stageDirectory, { recursive: true, force: true });
    await fs.rm(rollbackDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await lock.release();
  }
}
