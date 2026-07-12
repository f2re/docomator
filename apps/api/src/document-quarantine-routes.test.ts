import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import {
  buildZipFixture,
  minimalDocxEntries
} from "@docomator/document-intake/testing";
import { DEFAULT_SPACE_ID } from "@docomator/storage";

import { buildApp } from "./app.js";

function applyMigrations(dataDir: string): void {
  const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  const migrations = fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    database.exec(
      fs.readFileSync(path.join(migrationsDirectory, migration), "utf8")
    );
  }
  database.close();
}

async function testApp() {
  const dataDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-quarantine-api-")
  );
  applyMigrations(dataDir);
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    })
  );
  return { app, dataDir };
}

const contentType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function checkedDocx(): Buffer {
  return buildZipFixture(minimalDocxEntries());
}

test("explicit confirmation quarantines an accepted document and lists it", async () => {
  const { app, dataDir } = await testApp();
  try {
    const payload = checkedDocx();
    const url = `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/quarantine?fileName=${encodeURIComponent("Шаблон.docx")}`;
    const first = await app.inject({
      method: "POST",
      url,
      headers: {
        "content-type": contentType,
        "x-actor-id": "editor-1",
        "x-correlation-id": "corr-quarantine-api"
      },
      payload
    });

    assert.equal(first.statusCode, 201, first.body);
    const firstBody = first.json() as {
      data: {
        id: string;
        fileName: string;
        sha256: string;
        spaceId: string;
        decision: string;
        storagePath: string;
      };
      correlationId: string;
    };
    assert.equal(firstBody.data.fileName, "Шаблон.docx");
    assert.equal(firstBody.data.spaceId, DEFAULT_SPACE_ID);
    assert.equal(firstBody.data.decision, "accepted");
    assert.equal(firstBody.correlationId, "corr-quarantine-api");
    assert.equal(
      fs.existsSync(path.join(dataDir, "objects", firstBody.data.storagePath)),
      true
    );

    const duplicate = await app.inject({
      method: "POST",
      url,
      headers: { "content-type": contentType },
      payload
    });
    assert.equal(duplicate.statusCode, 201, duplicate.body);
    assert.equal(duplicate.json().data.id, firstBody.data.id);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources`
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().data.length, 1);
    assert.equal(list.json().data[0].id, firstBody.data.id);

    const one = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${firstBody.data.id}`
    });
    assert.equal(one.statusCode, 200, one.body);
    assert.equal(one.json().data.sha256, firstBody.data.sha256);

    const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
    const eventCount = database
      .prepare(
        "SELECT COUNT(*) AS value FROM domain_events WHERE event_type = 'document.quarantined'"
      )
      .get() as { value: number };
    const auditCount = database
      .prepare(
        "SELECT COUNT(*) AS value FROM audit_log WHERE object_type = 'document_source'"
      )
      .get() as { value: number };
    database.close();
    assert.equal(Number(eventCount.value), 1);
    assert.equal(Number(auditCount.value), 1);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});

test("a rejected document cannot be placed in quarantine", async () => {
  const { app, dataDir } = await testApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/quarantine?fileName=macro.docx`,
      headers: { "content-type": "application/octet-stream" },
      payload: buildZipFixture([
        ...minimalDocxEntries(),
        { name: "word/vbaProject.bin", content: Buffer.from([1, 2, 3]) }
      ])
    });

    assert.equal(response.statusCode, 422, response.body);
    const body = response.json() as {
      error: { code: string; message: string };
      correlationId: string;
    };
    assert.equal(body.error.code, "document_rejected");
    assert.match(body.error.message, /нельзя сохранить/u);
    assert.ok(body.correlationId.length > 0);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources`
    });
    assert.deepEqual(list.json().data, []);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});

test("quarantine lookup does not expose a record through another space", async () => {
  const { app, dataDir } = await testApp();
  try {
    const createdSpace = await app.inject({
      method: "POST",
      url: "/api/v1/spaces",
      headers: { "content-type": "application/json" },
      payload: { key: "other", name: "Другое пространство" }
    });
    assert.equal(createdSpace.statusCode, 201, createdSpace.body);
    const otherSpaceId = createdSpace.json().data.id as string;

    const saved = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/quarantine?fileName=template.docx`,
      headers: { "content-type": contentType },
      payload: checkedDocx()
    });
    assert.equal(saved.statusCode, 201, saved.body);

    const hidden = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${otherSpaceId}/document-sources/${saved.json().data.id}`
    });
    assert.equal(hidden.statusCode, 404, hidden.body);
    assert.match(hidden.json().error.message, /не найден/u);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});
