import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SqliteStore } from "@docomator/storage";
import Fastify from "fastify";

import { registerDataExportRoutes } from "./data-export-routes.js";

async function exportFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "docomator-export-"));
  const store = new SqliteStore({ databasePath: path.join(directory, "docomator.db") });
  store.execute((database) => {
    database.exec(`
      CREATE TABLE spaces(id TEXT PRIMARY KEY, key TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE entity_types(id TEXT PRIMARY KEY, key TEXT NOT NULL, label TEXT NOT NULL);
      CREATE TABLE entities(
        id TEXT PRIMARY KEY,
        entity_type_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE space_entity_ownership(space_id TEXT NOT NULL, entity_id TEXT NOT NULL);
      CREATE TABLE property_definitions(
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        label TEXT NOT NULL,
        unit TEXT,
        value_type TEXT NOT NULL,
        applies_to_json TEXT NOT NULL
      );
      CREATE TABLE space_property_definitions(
        space_id TEXT NOT NULL,
        property_definition_id TEXT NOT NULL
      );
      CREATE TABLE entity_property_values(
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        property_definition_id TEXT NOT NULL,
        value_json TEXT NOT NULL,
        version INTEGER NOT NULL
      );
    `);
    const insertSpace = database.prepare("INSERT INTO spaces VALUES (?, ?, ?)");
    insertSpace.run("space-a", "alpha", "Альфа");
    insertSpace.run("space-b", "beta", "Бета");
    database.prepare("INSERT INTO entity_types VALUES (?, ?, ?)").run(
      "type-room",
      "room",
      "Аудитория"
    );
    const insertEntity = database.prepare("INSERT INTO entities VALUES (?, ?, ?, ?)");
    insertEntity.run("entity-a", "type-room", "=2+2", "active");
    insertEntity.run("entity-b", "type-room", "Чужая аудитория", "active");
    const ownership = database.prepare("INSERT INTO space_entity_ownership VALUES (?, ?)");
    ownership.run("space-a", "entity-a");
    ownership.run("space-b", "entity-b");
    const property = database.prepare(
      "INSERT INTO property_definitions VALUES (?, ?, ?, ?, ?, ?)"
    );
    property.run("prop-a", "room.capacity.a", "Вместимость", "мест", "integer", '["room"]');
    property.run("prop-b", "room.capacity.b", "Вместимость", "мест", "integer", '["room"]');
    property.run("prop-note", "room.note.a", "Примечание", null, "string", '["room"]');
    const scope = database.prepare("INSERT INTO space_property_definitions VALUES (?, ?)");
    scope.run("space-a", "prop-a");
    scope.run("space-a", "prop-note");
    scope.run("space-b", "prop-b");
    const value = database.prepare(
      "INSERT INTO entity_property_values VALUES (?, ?, ?, ?, ?)"
    );
    value.run("value-a1", "entity-a", "prop-a", "10", 1);
    value.run("value-a2", "entity-a", "prop-a", "12", 2);
    value.run("value-a3", "entity-a", "prop-note", '"@опасная формула"', 1);
    value.run("value-b1", "entity-b", "prop-b", "99", 1);
  });
  return { directory, store };
}

test("CSV-экспорт остаётся внутри пространства и берёт последние значения", async () => {
  const fixture = await exportFixture();
  const app = Fastify({ logger: false });
  registerDataExportRoutes(app, fixture.store);

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/spaces/space-a/data-export.csv?entityTypeKey=room"
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/csv; charset=utf-8");
  assert.equal(response.headers["x-docomator-export-count"], "1");
  assert.match(String(response.headers["content-disposition"]), /docomator-alpha-room-/u);
  assert.ok(response.body.startsWith("\uFEFF"));
  assert.match(response.body, /"Название";"Статус";"Вместимость, мест";"Примечание"/u);
  assert.match(response.body, /"'=2\+2";"Активен";"12";"'@опасная формула"/u);
  assert.doesNotMatch(response.body, /Чужая аудитория/u);
  assert.doesNotMatch(response.body, /99/u);

  await app.close();
  fixture.store.close();
  await fs.rm(fixture.directory, { recursive: true, force: true });
});

test("CSV-экспорт пустого типа возвращает заголовки без фиктивных строк", async () => {
  const fixture = await exportFixture();
  const app = Fastify({ logger: false });
  registerDataExportRoutes(app, fixture.store);
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/spaces/space-a/data-export.csv?entityTypeKey=room"
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-docomator-export-count"], "1");

  const missing = await app.inject({
    method: "GET",
    url: "/api/v1/spaces/space-a/data-export.csv?entityTypeKey=missing"
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "entity_type_not_found");

  await app.close();
  fixture.store.close();
  await fs.rm(fixture.directory, { recursive: true, force: true });
});
