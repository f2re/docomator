import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migrationScript = path.resolve("scripts/runtime/migrate.mjs");

test("bootstrap migration is repeatable", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-migrate-"));
  const env = { ...process.env, DOCOMATOR_DATA_DIR: dataDir };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(process.execPath, [migrationScript], {
      env,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
  const migration = database
    .prepare("SELECT name FROM schema_migrations")
    .get();
  const table = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'automation_rules'"
    )
    .get();

  assert.equal(migration.name, "0001_bootstrap.sql");
  assert.equal(table.name, "automation_rules");
  database.close();
});
