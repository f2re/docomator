#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const migrationsDirectory = path.resolve(
  process.env.DOCOMATOR_MIGRATIONS_DIR ?? path.join(repositoryRoot, "migrations")
);
const dataDirectory = path.resolve(
  process.env.DOCOMATOR_DATA_DIR ?? "/var/lib/docomator"
);
const databasePath = path.resolve(
  process.env.DOCOMATOR_DATABASE_PATH ?? path.join(dataDirectory, "docomator.db")
);

fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o750 });

const database = new DatabaseSync(databasePath);

database.exec("PRAGMA foreign_keys = ON;");
database.exec("PRAGMA journal_mode = WAL;");
database.exec("PRAGMA synchronous = FULL;");
database.exec("PRAGMA busy_timeout = 5000;");
database.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`);

const appliedRows = database
  .prepare("SELECT name, checksum FROM schema_migrations ORDER BY name")
  .all();
const applied = new Map(appliedRows.map((row) => [row.name, row.checksum]));

const migrationFiles = fs
  .readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^\d{4}_.+\.sql$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

for (const migrationName of migrationFiles) {
  const migrationPath = path.join(migrationsDirectory, migrationName);
  const sql = fs.readFileSync(migrationPath, "utf8");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  const previousChecksum = applied.get(migrationName);

  if (previousChecksum !== undefined) {
    if (previousChecksum !== checksum) {
      throw new Error(
        `Migration checksum mismatch for ${migrationName}. Applied migrations are immutable.`
      );
    }
    continue;
  }

  database.exec("BEGIN IMMEDIATE;");
  try {
    database.exec(sql);
    database
      .prepare(
        "INSERT INTO schema_migrations(name, checksum, applied_at) VALUES (?, ?, ?)"
      )
      .run(migrationName, checksum, new Date().toISOString());
    database.exec("COMMIT;");
    process.stdout.write(`Applied migration ${migrationName}\n`);
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

database.close();
process.stdout.write(`Database is ready: ${databasePath}\n`);
