import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SpaceRegistry,
  SpaceScopedKnowledgeRegistry,
  SpaceScopedPublicationRegistry,
  SqliteStore
} from "@docomator/storage";
import Fastify from "fastify";

import { registerPublicationRoutes } from "./publication-routes.js";

const T0 = "2026-08-03T10:00:00.000Z";

function context(correlationId: string) {
  return {
    correlationId,
    actorType: "test",
    actorId: "operator-api",
    now: T0
  };
}

async function fixture(t: TestContext) {
  const directory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-publication-api-")
  );
  const databasePath = path.join(directory, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.close();

  const store = new SqliteStore({ databasePath });
  const spaces = new SpaceRegistry(store);
  const publications = new SpaceScopedPublicationRegistry(store);
  const space = spaces.createSpace(
    { key: "science", name: "Научная деятельность" },
    context("corr-space")
  );
  const configuration = publications.ensureDefaultConfiguration(
    space.id,
    context("corr-bootstrap")
  );
  const publicationYearPropertyKey = configuration.publicationYearPropertyKey;
  assert.ok(publicationYearPropertyKey);
  const knowledge = new SpaceScopedKnowledgeRegistry(store, space.id, { spaces });
  const teacher = spaces.createEntity(
    space.id,
    { entityTypeKey: "person", displayName: "Иванов Иван Иванович" },
    context("corr-teacher")
  );
  const publication = spaces.createEntity(
    space.id,
    {
      entityTypeKey: "scientific-publication",
      displayName: "Прогноз опасных конвективных явлений"
    },
    context("corr-publication")
  );
  knowledge.appendPropertyValue(
    {
      entityId: publication.entityId,
      propertyKey: publicationYearPropertyKey,
      value: 2026,
      sourceType: "test"
    },
    context("corr-year")
  );
  publications.replaceAuthors(
    space.id,
    publication.entityId,
    [{ authorEntityId: teacher.entityId }],
    context("corr-authors")
  );
  publications.setClassification(
    space.id,
    publication.entityId,
    "vak",
    { state: "confirmed", source: "Перечень ВАК" },
    context("corr-vak")
  );

  const app = Fastify({ logger: false });
  registerPublicationRoutes(app, publications);
  await app.ready();
  t.after(async () => {
    await app.close();
    store.close();
    await fsPromises.rm(directory, { recursive: true, force: true });
  });
  return { app, space, teacher, publication };
}

test("publication API previews and exports a filtered annual report", async (t) => {
  const { app, space, publication } = await fixture(t);
  const preview = await app.inject({
    method: "GET",
    url: `/api/v1/spaces/${encodeURIComponent(space.id)}/publications/reports/preview?year=2026&classifications=vak`
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.headers["cache-control"], "no-store");
  const payload = preview.json();
  assert.equal(payload.data.totals.uniquePublications, 1);
  assert.equal(payload.data.totals.authorships, 1);
  assert.equal(payload.data.rows[0].publicationEntityId, publication.entityId);

  const exported = await app.inject({
    method: "GET",
    url: `/api/v1/spaces/${encodeURIComponent(space.id)}/publications/reports/export.csv?year=2026&classifications=vak`
  });
  assert.equal(exported.statusCode, 200);
  assert.match(exported.headers["content-type"] ?? "", /text\/csv/u);
  assert.match(exported.body, /Прогноз опасных конвективных явлений/u);
  assert.match(exported.body, /ВАК/u);
});

test("publication API creates a document audience from report criteria", async (t) => {
  const { app, space } = await fixture(t);
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${encodeURIComponent(space.id)}/publications/reports/audience-snapshot`,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": "corr-api-audience",
      "x-actor-id": "operator-api"
    },
    payload: {
      criteria: {
        year: 2026,
        classifications: "vak"
      }
    }
  });
  assert.equal(response.statusCode, 201);
  const payload = response.json();
  assert.equal(payload.data.report.totals.uniquePublications, 1);
  assert.equal(payload.data.audience.snapshot.memberCount, 1);
  assert.equal(payload.data.audience.plan.targetMode, "aggregate");
});

test("publication API reuses an immutable report snapshot for CSV and document composition", async (t) => {
  const { app, space } = await fixture(t);
  const created = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${encodeURIComponent(space.id)}/publications/reports/snapshots`,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": "corr-api-report-snapshot",
      "x-actor-id": "operator-api"
    },
    payload: {
      criteria: {
        year: 2026,
        classifications: "vak"
      }
    }
  });
  assert.equal(created.statusCode, 201);
  const snapshot = created.json().data;
  assert.equal(snapshot.rowCount, 1);

  const exported = await app.inject({
    method: "GET",
    url: `/api/v1/spaces/${encodeURIComponent(space.id)}/publications/reports/snapshots/${encodeURIComponent(snapshot.id)}/export.csv`
  });
  assert.equal(exported.statusCode, 200);
  assert.match(exported.body, /Прогноз опасных конвективных явлений/u);

  const audience = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${encodeURIComponent(space.id)}/publications/reports/snapshots/${encodeURIComponent(snapshot.id)}/audience-snapshot`,
    headers: {
      "x-correlation-id": "corr-api-snapshot-audience",
      "x-actor-id": "operator-api"
    }
  });
  assert.equal(audience.statusCode, 201);
  assert.equal(audience.json().data.audience.snapshot.memberCount, 1);
});
