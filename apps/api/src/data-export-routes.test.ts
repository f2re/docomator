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
    const insertType = database.prepare("INSERT INTO entity_types VALUES (?, ?, ?)");
    insertType.run("type-room", "room", "Аудитория");
    insertType.run("type-equipment", "equipment", "Оборудование");
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

async function closeFixture(
  app: ReturnType<typeof Fastify>,
  fixture: Awaited<ReturnType<typeof exportFixture>>
) {
  await app.close();
  fixture.store.close();
  await fs.rm(fixture.directory, { recursive: true, force: true });
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

  await closeFixture(app, fixture);
});

test("XLSX-экспорт сохраняет буквальные значения как текст и не создаёт формулы", async () => {
  const fixture = await exportFixture();
  const app = Fastify({ logger: false });
  registerDataExportRoutes(app, fixture.store);

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/spaces/space-a/data-export.xlsx?entityTypeKey=room"
  });
  assert.equal(response.statusCode, 200);
  assert.equal(
    response.headers["content-type"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.equal(response.headers["x-docomator-export-count"], "1");
  assert.match(String(response.headers["content-disposition"]), /\.xlsx"$/u);
  assert.equal(response.rawPayload.readUInt32LE(0), 0x04034b50);
  const archiveText = response.rawPayload.toString("utf8");
  assert.match(archiveText, />=2\+2</u);
  assert.match(archiveText, />@опасная формула</u);
  assert.doesNotMatch(archiveText, />'=2\+2</u);
  assert.doesNotMatch(archiveText, />'@опасная формула</u);
  assert.match(archiveText, />12</u);
  assert.doesNotMatch(archiveText, /Чужая аудитория/u);
  assert.doesNotMatch(archiveText, />99</u);
  assert.doesNotMatch(archiveText, /<f>/u);

  await closeFixture(app, fixture);
});

test("экспорт известного пустого типа возвращает только заголовок и нулевой count", async () => {
  const fixture = await exportFixture();
  const app = Fastify({ logger: false });
  registerDataExportRoutes(app, fixture.store);

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/spaces/space-a/data-export.csv?entityTypeKey=equipment"
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-docomator-export-count"], "0");
  const rows = response.body.replace(/^\uFEFF/u, "").trimEnd().split("\r\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0], '"Название";"Статус"');

  const missing = await app.inject({
    method: "GET",
    url: "/api/v1/spaces/space-a/data-export.csv?entityTypeKey=missing"
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "entity_type_not_found");

  await closeFixture(app, fixture);
});
