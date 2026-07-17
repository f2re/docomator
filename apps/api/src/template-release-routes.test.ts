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
  ContentAddressedObjectStore,
  DEFAULT_SPACE_ID,
  DocumentQuarantineRegistry,
  MultiFieldTestVersionRegistry,
  SqliteStore,
  TemplateDraftRegistry,
  TemplatePreviewActivationRegistry
} from "@docomator/storage";

import { buildApp } from "./app.js";

const NOW = "2026-07-13T07:00:00.000Z";
const STRUCTURE_SHA = "f".repeat(64);

function applyMigrations(dataDir: string): void {
  const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
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
}

function context(correlationId: string, offsetSeconds = 0) {
  return {
    correlationId,
    actorType: "test",
    actorId: "editor-1",
    now: new Date(Date.parse(NOW) + offsetSeconds * 1_000).toISOString()
  };
}

function binding(elementId: string, index: number) {
  return {
    version: 1,
    kind: "docx.paragraph",
    elementId,
    part: "word/document.xml",
    index
  };
}

function technicalBinding(fieldId: string, index: number) {
  return {
    kind: "docx.sdt",
    identifier: `aifield:${fieldId}`,
    part: "word/document.xml",
    target: `абзац ${index + 1}`
  };
}

function pdf(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n% Docomator multi release\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"
  );
}

async function setupApp() {
  const dataDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-release-api-")
  );
  applyMigrations(dataDir);
  const store = new SqliteStore({ databasePath: path.join(dataDir, "docomator.db") });
  const objectStore = new ContentAddressedObjectStore(path.join(dataDir, "objects"));
  const quarantine = new DocumentQuarantineRegistry(store, objectStore);
  const drafts = new TemplateDraftRegistry(store);
  const multiVersions = new MultiFieldTestVersionRegistry(store, objectStore);
  const releases = new TemplatePreviewActivationRegistry(store, objectStore);

  const source = await quarantine.saveAcceptedDocument(
    {
      spaceId: DEFAULT_SPACE_ID,
      fileName: "Письмо.docx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      format: "docx",
      decision: "accepted",
      buffer: Buffer.from("verified-source"),
      report: { decision: "accepted" }
    },
    context("corr-source")
  );
  const draft = drafts.createOrGetDraft(
    {
      spaceId: DEFAULT_SPACE_ID,
      sourceRecordId: source.id,
      title: "Официальное письмо",
      format: "docx",
      sourceSha256: source.sha256,
      structureSha256: STRUCTURE_SHA,
      structure: {
        elements: [
          { id: "paragraph-1", kind: "paragraph" },
          { id: "paragraph-2", kind: "paragraph" }
        ]
      },
      structureTruncated: false
    },
    context("corr-draft")
  );
  const nameBinding = binding("paragraph-1", 0);
  const positionBinding = binding("paragraph-2", 1);
  const nameField = drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "recipient.full_name",
      label: "ФИО получателя",
      valueType: "string",
      required: true,
      elementId: "paragraph-1",
      elementKind: "paragraph",
      binding: nameBinding,
      originalPreview: "ФИО получателя",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-name-field")
  );
  const positionField = drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "recipient.position",
      label: "Должность получателя",
      valueType: "string",
      required: true,
      elementId: "paragraph-2",
      elementKind: "paragraph",
      binding: positionBinding,
      originalPreview: "Должность получателя",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-position-field")
  );
  const version = await multiVersions.recordTestedVersion(
    {
      spaceId: DEFAULT_SPACE_ID,
      draftId: draft.id,
      format: "docx",
      compiledBuffer: Buffer.from("multi-compiled-template"),
      trialBuffer: Buffer.from("multi-trial-template"),
      fields: [
        {
          fieldId: nameField.id,
          fieldKey: "recipient.full_name",
          fieldLabel: "ФИО получателя",
          valueType: "string",
          required: true,
          binding: nameBinding,
          technicalBinding: technicalBinding(nameField.id, 0),
          sampleValue: "Иванов Иван Иванович",
          renderedValue: "Иванов Иван Иванович",
          readBackValue: "Иванов Иван Иванович",
          verification: { matched: true }
        },
        {
          fieldId: positionField.id,
          fieldKey: "recipient.position",
          fieldLabel: "Должность получателя",
          valueType: "string",
          required: true,
          binding: positionBinding,
          technicalBinding: technicalBinding(positionField.id, 1),
          sampleValue: "Ведущий инженер",
          renderedValue: "Ведущий инженер",
          readBackValue: "Ведущий инженер",
          verification: { matched: true }
        }
      ],
      verification: { allMatched: true, fieldCount: 2 }
    },
    context("corr-version", 1)
  );

  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    {
      store,
      objectStore,
      multiFieldTestVersionRegistry: multiVersions,
      templatePreviewActivationRegistry: releases
    }
  );
  return {
    app,
    dataDir,
    store,
    objectStore,
    releases,
    version,
    async cleanup() {
      await app.close();
      store.close();
      await fsPromises.rm(dataDir, { recursive: true, force: true });
    }
  };
}

test("API previews and activates a multi-field tested version", async () => {
  const setup = await setupApp();
  try {
    const requestedResponse = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-multi-test-versions/${setup.version.id}/preview`,
      headers: {
        "x-actor-id": "editor-1",
        "x-correlation-id": "corr-multi-preview-api"
      }
    });
    assert.equal(requestedResponse.statusCode, 202, requestedResponse.body);
    const requested = requestedResponse.json().data.request as {
      id: string;
      versionId: string;
      versionKind: string;
      fieldCount: number;
      state: string;
    };
    assert.equal(requested.versionId, setup.version.id);
    assert.equal(requested.versionKind, "multi");
    assert.equal(requested.fieldCount, 2);
    assert.equal(requested.state, "pending");

    const wrongRoute = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-test-versions/${setup.version.id}/preview`
    });
    assert.equal(wrongRoute.statusCode, 404, wrongRoute.body);

    const ready = await setup.releases.completePreview(
      {
        requestId: requested.id,
        previewBuffer: pdf(),
        converter: {
          converter: "LibreOffice",
          binaryName: "libreoffice",
          durationMs: 50,
          outputBytes: pdf().byteLength
        }
      },
      context("corr-ready", 2)
    );
    assert.equal(ready.state, "ready");

    const status = await setup.app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-previews/${ready.id}`
    });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().data.request.versionKind, "multi");
    assert.equal(status.json().data.request.fieldCount, 2);
    assert.equal(status.json().data.canActivate, true);

    const activatedResponse = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-previews/${ready.id}/activate`,
      headers: {
        "x-actor-id": "editor-1",
        "x-correlation-id": "corr-multi-activate-api"
      }
    });
    assert.equal(activatedResponse.statusCode, 201, activatedResponse.body);
    const active = activatedResponse.json().data.active as {
      id: string;
      versionKind: string;
      fieldCount: number;
      compiledSha256: string;
      manifest: {
        version: number;
        fieldCount: number;
        fields: Array<{ key: string }>;
      };
    };
    assert.equal(active.versionKind, "multi");
    assert.equal(active.fieldCount, 2);
    assert.equal(active.compiledSha256, setup.version.compiledSha256);
    assert.equal(active.manifest.version, 4);
    assert.equal(active.manifest.fieldCount, 2);
    assert.deepEqual(
      active.manifest.fields.map((field) => field.key),
      ["recipient.full_name", "recipient.position"]
    );

    const catalog = await setup.app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/active-templates`
    });
    assert.equal(catalog.statusCode, 200, catalog.body);
    assert.equal(catalog.json().data.length, 1);
    assert.equal(catalog.json().data[0].id, active.id);
    assert.equal(catalog.json().data[0].versionKind, "multi");
    assert.equal(catalog.json().data[0].fieldCount, 2);

    const compiled = await setup.app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/active-templates/${active.id}/files/compiled`
    });
    assert.equal(compiled.statusCode, 200, compiled.body);
    assert.equal(compiled.rawPayload.toString(), "multi-compiled-template");
  } finally {
    await setup.cleanup();
  }
});
