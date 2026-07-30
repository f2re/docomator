import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const script = path.resolve(import.meta.dirname, "db-admin.mjs");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-db-admin-"));
  const databasePath = path.join(directory, "docomator.sqlite3");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE entity_types (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL
    );
    CREATE TABLE property_definitions (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT,
      value_type TEXT NOT NULL,
      unit TEXT,
      sensitivity TEXT NOT NULL,
      validation_json TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      applies_to_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE demo (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      value TEXT
    );
    INSERT INTO entity_types(key, label) VALUES ('room', 'Аудитория');
    INSERT INTO demo(id, label, value) VALUES
      (1, 'Бета', '=опасная формула'),
      (2, 'Альфа', 'обычное значение');
  `);
  database.close();
  return {
    directory,
    databasePath,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true })
  };
}

function run(databasePath, args) {
  return spawnSync(process.execPath, [script, ...args, "--database", databasePath], {
    encoding: "utf8"
  });
}

test("database administrator lists, sorts, and exports only validated tables", () => {
  const current = fixture();
  try {
    const tables = run(current.databasePath, ["tables"]);
    assert.equal(tables.status, 0, tables.stderr);
    assert.match(tables.stdout, /demo/u);
    assert.match(tables.stdout, /property_definitions/u);

    const rows = run(current.databasePath, [
      "rows",
      "demo",
      "--order-by",
      "label",
      "--format",
      "json"
    ]);
    assert.equal(rows.status, 0, rows.stderr);
    const parsed = JSON.parse(rows.stdout);
    assert.deepEqual(parsed.map((row) => row.label), ["Альфа", "Бета"]);

    const exported = path.join(current.directory, "demo.csv");
    const exportResult = run(current.databasePath, [
      "export",
      "demo",
      "--output",
      exported,
      "--order-by",
      "id"
    ]);
    assert.equal(exportResult.status, 0, exportResult.stderr);
    const csv = fs.readFileSync(exported, "utf8");
    assert.match(csv, /'=опасная формула/u);

    const rejected = run(current.databasePath, ["rows", "demo; DROP TABLE demo"]);
    assert.notEqual(rejected.status, 0);
    const database = new DatabaseSync(current.databasePath, { readOnly: true });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM demo").get().count, 2);
    database.close();
  } finally {
    current.cleanup();
  }
});

test("adding an application property requires confirmation and creates a consistent backup", () => {
  const current = fixture();
  try {
    const refused = run(current.databasePath, [
      "add-property",
      "--label",
      "Вместимость",
      "--entity-type",
      "room",
      "--value-type",
      "integer"
    ]);
    assert.notEqual(refused.status, 0);

    const backupDir = path.join(current.directory, "backups");
    const added = run(current.databasePath, [
      "add-property",
      "--label",
      "Вместимость",
      "--entity-type",
      "room",
      "--value-type",
      "integer",
      "--unit",
      "мест",
      "--backup-dir",
      backupDir,
      "--confirm-write"
    ]);
    assert.equal(added.status, 0, added.stderr);
    const backups = fs.readdirSync(backupDir);
    assert.equal(backups.length, 1);

    const database = new DatabaseSync(current.databasePath, { readOnly: true });
    const property = database
      .prepare(
        "SELECT key, label, value_type, unit, sensitivity, applies_to_json FROM property_definitions"
      )
      .get();
    database.close();
    assert.equal(property.label, "Вместимость");
    assert.equal(property.value_type, "integer");
    assert.equal(property.unit, "мест");
    assert.equal(property.sensitivity, "internal");
    assert.deepEqual(JSON.parse(property.applies_to_json), ["room"]);

    const backup = new DatabaseSync(path.join(backupDir, backups[0]), {
      readOnly: true
    });
    assert.equal(
      backup.prepare("SELECT COUNT(*) AS count FROM property_definitions").get().count,
      0
    );
    backup.close();
  } finally {
    current.cleanup();
  }
});
