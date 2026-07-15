#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createBackup, verifyBackup } from "./backup-lib.mjs";

function parseBoolean(value, fallback) {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseInteger(name, value, fallback, minimum, maximum) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer in range ${minimum}..${maximum}`);
  }
  return parsed;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function atomicJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o750 });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o640
  });
  await fs.rename(temporary, filePath);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock(dataDirectory) {
  const lockDirectory = path.join(dataDirectory, ".backup.lock");
  const ownerPath = path.join(lockDirectory, "owner.json");
  await fs.mkdir(dataDirectory, { recursive: true, mode: 0o750 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.mkdir(lockDirectory, { mode: 0o700 });
      await fs.writeFile(
        ownerPath,
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
        { encoding: "utf8", mode: 0o600 }
      );
      return {
        async release() {
          await fs.rm(lockDirectory, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "EEXIST")) {
        throw error;
      }
      const current = await fs.readFile(ownerPath, "utf8").catch(() => "");
      let ownerPid = 0;
      try {
        ownerPid = Number(JSON.parse(current).pid);
      } catch {
        ownerPid = 0;
      }
      if (processAlive(ownerPid)) return null;
      await fs.rm(lockDirectory, { recursive: true, force: true });
    }
  }
  return null;
}

const dataDirectory = path.resolve(
  process.env.DOCOMATOR_DATA_DIR ?? "/var/lib/docomator"
);
const backupDirectory = path.join(dataDirectory, "backups");
const statusPath = path.join(backupDirectory, "automatic-backup-status.json");
const enabled = parseBoolean(process.env.DOCOMATOR_BACKUP_ENABLED, true);
const retentionCount = parseInteger(
  "DOCOMATOR_BACKUP_RETENTION",
  process.env.DOCOMATOR_BACKUP_RETENTION,
  7,
  1,
  365
);
const configFile = path.resolve(
  process.env.DOCOMATOR_CONFIG_FILE ?? "/etc/docomator/docomator.env"
);
const startedAt = new Date().toISOString();

if (!enabled) {
  await atomicJson(statusPath, {
    state: "disabled",
    startedAt,
    completedAt: startedAt,
    message: "Автоматическое резервирование отключено настройкой."
  });
  process.stdout.write(`${JSON.stringify({ status: "disabled" })}\n`);
  process.exit(0);
}

const lock = await acquireLock(dataDirectory);
if (lock === null) {
  process.stdout.write(
    `${JSON.stringify({ status: "skipped", reason: "backup_already_running" })}\n`
  );
  process.exit(0);
}

await atomicJson(statusPath, {
  state: "running",
  startedAt,
  completedAt: null,
  retentionCount
});

try {
  const result = await createBackup({
    dataDirectory,
    outputParent: backupDirectory,
    configFile: (await exists(configFile)) ? configFile : undefined,
    releaseVersion: process.env.DOCOMATOR_VERSION ?? null,
    retentionCount,
    prefix: "backup"
  });
  const manifest = await verifyBackup(result.directory);
  const completedAt = new Date().toISOString();
  const status = {
    state: "completed",
    startedAt,
    completedAt,
    backupDirectory: result.directory,
    retentionCount,
    manifest: {
      createdAt: manifest.createdAt,
      releaseVersion: manifest.releaseVersion,
      databaseBytes: manifest.database?.sizeBytes ?? null,
      objectCount: manifest.objects?.count ?? null,
      configIncluded: manifest.config !== null
    }
  };
  await atomicJson(statusPath, status);
  process.stdout.write(
    `${JSON.stringify({ status: "ok", backup: result.directory, completedAt })}\n`
  );
} catch (error) {
  const completedAt = new Date().toISOString();
  await atomicJson(statusPath, {
    state: "failed",
    startedAt,
    completedAt,
    retentionCount,
    error: error instanceof Error ? error.message : String(error)
  }).catch(() => undefined);
  throw error;
} finally {
  await lock.release();
}
