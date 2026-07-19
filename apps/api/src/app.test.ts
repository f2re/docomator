import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";

import { buildApp } from "./app.js";

test("health endpoint reports the API service", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-api-"));
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_VERSION: "test-version",
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );

  const response = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().service, "api");
  assert.equal(response.json().version, "test-version");
  await app.close();
});

test("release identity distinguishes development from an installed release", async () => {
  const developmentDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "docomator-release-development-")
  );
  const developmentApp = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: developmentDataDir,
      DOCOMATOR_VERSION: "test-version",
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  const development = await developmentApp.inject({
    method: "GET",
    url: "/api/v1/system/release"
  });
  assert.equal(development.statusCode, 200);
  assert.deepEqual(development.json(), {
    name: "docomator",
    version: "test-version",
    gitCommit: null,
    releaseMetadataSha256: null,
    source: "development"
  });
  await developmentApp.close();

  const installedDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "docomator-release-installed-")
  );
  const releaseMetadataPath = path.join(installedDataDir, "release.json");
  const releaseSource = `${JSON.stringify({
    name: "docomator",
    version: "test-version",
    gitCommit: "a".repeat(40)
  })}\n`;
  await fs.writeFile(releaseMetadataPath, releaseSource);
  const installedApp = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: installedDataDir,
      DOCOMATOR_VERSION: "test-version",
      DOCOMATOR_LOG_LEVEL: "fatal",
      DOCOMATOR_RELEASE_METADATA_PATH: releaseMetadataPath
    })
  );
  const installed = await installedApp.inject({
    method: "GET",
    url: "/api/v1/system/release"
  });
  assert.equal(installed.statusCode, 200);
  assert.deepEqual(installed.json(), {
    name: "docomator",
    version: "test-version",
    gitCommit: "a".repeat(40),
    releaseMetadataSha256: createHash("sha256")
      .update(releaseSource)
      .digest("hex"),
    source: "installed"
  });
  assert.equal(installed.headers["cache-control"], "no-store");
  await installedApp.close();
});

test("release identity rejects metadata for another installed version", async () => {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "docomator-release-mismatch-")
  );
  const releaseMetadataPath = path.join(dataDir, "release.json");
  await fs.writeFile(
    releaseMetadataPath,
    `${JSON.stringify({
      name: "docomator",
      version: "another-version",
      gitCommit: "b".repeat(40)
    })}\n`
  );
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_VERSION: "test-version",
      DOCOMATOR_LOG_LEVEL: "fatal",
      DOCOMATOR_RELEASE_METADATA_PATH: releaseMetadataPath
    })
  );
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/system/release"
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, "release_identity_unavailable");
  assert.match(response.json().error.message, /идентичность/iu);
  await app.close();
});

test("readiness stays degraded before migrations create the database", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-ready-"));
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );

  const response = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.database, "error");
  await app.close();
});

test("readiness stays degraded until employee update idempotency migration is applied", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-ready-0022-"));
  const databasePath = path.join(dataDir, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fsSync
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    database.exec(fsSync.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    DROP TABLE employee_update_requests;
  `);
  database.close();

  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  const response = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.database, "error");
  await app.close();
});

test("readiness stays degraded until template formatter migration is applied", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-ready-0023-"));
  const databasePath = path.join(dataDir, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fsSync
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < "0023_")
    .sort()) {
    database.exec(fsSync.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  database.close();

  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  const response = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.database, "error");
  await app.close();
});

test("readiness stays degraded until DOCX repeat migration is applied", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-ready-0024-"));
  const databasePath = path.join(dataDir, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fsSync
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < "0024_")
    .sort()) {
    database.exec(fsSync.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  database.close();

  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  const response = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.database, "error");
  await app.close();
});

test("readiness stays degraded until XLSX repeat migration is registered", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-ready-0025-"));
  const databasePath = path.join(dataDir, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  const migrations = fsSync
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < "0025_")
    .sort();
  for (const migration of migrations) {
    database.exec(fsSync.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const insert = database.prepare(
    "INSERT OR REPLACE INTO schema_migrations(name, checksum, applied_at) VALUES (?, ?, ?)"
  );
  for (const migration of migrations) {
    insert.run(migration, "test-checksum", "2026-07-18T00:00:00.000Z");
  }
  database.close();

  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  const response = await app.inject({ method: "GET", url: "/readyz" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().checks.database, "error");
  await app.close();
});
