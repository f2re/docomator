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
  SpaceRegistry,
  SqliteStore,
  TemplateDraftRegistry,
  TemplatePreviewActivationRegistry,
  TemplateTestVersionRegistry
} from "@docomator/storage";

import { buildApp } from "./app.js";

const NOW = "2026-07-13T00:00:00.000Z";
const STRUCTURE_SHA = "d".repeat(64);

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

async function setupApp() {
  const dataDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-preview-api-")
  );
  applyMigrations(dataDir);
  const store = new SqliteStore({ databasePath: path.join(dataDir, "docomator.db") });
  const objectStore = new ContentAddressedObjectStore(path.join(dataDir, "objects"));
  const quarantine = new DocumentQuarantineRegistry(store, objectStore);
  const drafts = new TemplateDraftRegistry(store);
  const testedVersions = new TemplateTestVersionRegistry(store, objectStore);
  const previews = new TemplatePreviewActivationRegistry(store, objectStore);

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
      structure: { elements: [{ id: "paragraph-1" }] },
      structureTruncated: false
    },
    context("corr-draft")
  );
  const field = drafts.createField(
    DEFAULT_SPACE_ID,
    draft.id,
    {
      key: "recipient.full_name",
      label: "ФИО получателя",
      valueType: "string",
      required: true,
      elementId: "paragraph-1",
      elementKind: "paragraph",
      binding: {
        version: 1,
        kind: "docx.paragraph",
        elementId: "paragraph-1",
        part: "word/document.xml",
        index: 0
      },
      originalPreview: "ФИО получателя",
      structureSha256: STRUCTURE_SHA
    },
    context("corr-field")
  );
  const tested = await testedVersions.recordTestedVersion(
    {
      spaceId: DEFAULT_SPACE_ID,
      draftId: draft.id,
      fieldId: field.id,
      format: "docx",
      compiledBuffer: Buffer.from("compiled-template"),
      trialBuffer: Buffer.from("trial-template"),
      technicalBinding: {
        kind: "docx.sdt",
        identifier: `aifield:${field.id}`,
        part: "word/document.xml",
        target: "абзац 1"
      },
      sampleValue: "Иванов",
      renderedValue: "Иванов",
      readBackValue: "Иванов",
      verification: { matched: true }
    },
    context("corr-tested")
  );

  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: dataDir,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    {
      store,
      objectStore,
      templatePreviewActivationRegistry: previews
    }
  );
  return {
    dataDir,
    store,
    objectStore,
    previews,
    tested,
    app,
    async cleanup() {
      await app.close();
      store.close();
      await fsPromises.rm(dataDir, { recursive: true, force: true });
    }
  };
}

function pdf(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n% Docomator preview\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"
  );
}

test("API exposes persistent preview state, PDF, activation and active catalog", async () => {
  const setup = await setupApp();
  try {
    const requestResponse = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-test-versions/${setup.tested.id}/preview`,
      headers: {
        "x-actor-id": "editor-1",
        "x-correlation-id": "corr-preview-api"
      }
    });
    assert.equal(requestResponse.statusCode, 202, requestResponse.body);
    const requested = requestResponse.json() as {
      data: {
        request: { id: string; state: string; workerJobId: string };
        created: boolean;
        retried: boolean;
        statusUrl: string;
      };
      correlationId: string;
    };
    assert.equal(requested.data.created, true);
    assert.equal(requested.data.retried, false);
    assert.equal(requested.data.request.state, "pending");
    assert.equal(requested.correlationId, "corr-preview-api");

    const duplicate = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-test-versions/${setup.tested.id}/preview`
    });
    assert.equal(duplicate.statusCode, 202, duplicate.body);
    assert.equal(
      duplicate.json().data.request.id,
      requested.data.request.id
    );
    assert.equal(duplicate.json().data.created, false);

    const pendingActivation = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-previews/${requested.data.request.id}/activate`
    });
    assert.equal(pendingActivation.statusCode, 400, pendingActivation.body);
    assert.match(
      pendingActivation.json().error.message,
      /дождитесь готового предварительного просмотра/ui
    );

    const ready = await setup.previews.completePreview(
      {
        requestId: requested.data.request.id,
        previewBuffer: pdf(),
        converter: {
          converter: "LibreOffice",
          binaryName: "libreoffice",
          durationMs: 50,
          outputBytes: pdf().byteLength
        }
      },
      context("corr-ready", 1)
    );
    assert.equal(ready.state, "ready");

    const statusResponse = await setup.app.inject({
      method: "GET",
      url: requested.data.statusUrl
    });
    assert.equal(statusResponse.statusCode, 200, statusResponse.body);
    assert.equal(statusResponse.json().data.canActivate, true);
    assert.equal(statusResponse.json().data.request.state, "ready");

    const previewResponse = await setup.app.inject({
      method: "GET",
      url: statusResponse.json().data.previewUrl
    });
    assert.equal(previewResponse.statusCode, 200, previewResponse.body);
    assert.equal(previewResponse.headers["content-type"], "application/pdf");
    assert.match(previewResponse.headers["content-disposition"] ?? "", /^inline;/u);
    assert.equal(previewResponse.rawPayload.subarray(0, 5).toString(), "%PDF-");

    const activationResponse = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-previews/${ready.id}/activate`,
      headers: {
        "x-actor-id": "editor-1",
        "x-correlation-id": "corr-activate-api"
      }
    });
    assert.equal(activationResponse.statusCode, 201, activationResponse.body);
    const active = activationResponse.json().data.active as {
      id: string;
      versionNumber: number;
      title: string;
      compiledSha256: string;
      previewSha256: string;
    };
    assert.equal(active.versionNumber, 1);
    assert.equal(active.title, "Официальное письмо");
    assert.equal(activationResponse.json().correlationId, "corr-activate-api");

    const catalog = await setup.app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/active-templates`
    });
    assert.equal(catalog.statusCode, 200, catalog.body);
    assert.equal(catalog.json().data.length, 1);
    assert.equal(catalog.json().data[0].id, active.id);

    const compiled = await setup.app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/active-templates/${active.id}/files/compiled`
    });
    assert.equal(compiled.statusCode, 200, compiled.body);
    assert.equal(compiled.rawPayload.toString(), "compiled-template");

    const activePreview = await setup.app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/active-templates/${active.id}/files/preview`
    });
    assert.equal(activePreview.statusCode, 200, activePreview.body);
    assert.equal(activePreview.rawPayload.subarray(0, 5).toString(), "%PDF-");

    const repeatedActivation = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-previews/${ready.id}/activate`
    });
    assert.equal(repeatedActivation.statusCode, 201, repeatedActivation.body);
    assert.equal(repeatedActivation.json().data.active.id, active.id);
  } finally {
    await setup.cleanup();
  }
});

test("API retries a failed preview and hides requests from another space", async () => {
  const setup = await setupApp();
  try {
    const requested = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-test-versions/${setup.tested.id}/preview`
    });
    const requestId = requested.json().data.request.id as string;
    setup.previews.failPreview(
      requestId,
      {
        code: "preview_conversion_failed",
        message: "LibreOffice не смог создать PDF."
      },
      context("corr-failed", 1)
    );

    const failedStatus = await setup.app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-previews/${requestId}`
    });
    assert.equal(failedStatus.statusCode, 200, failedStatus.body);
    assert.equal(failedStatus.json().data.request.state, "failed");
    assert.equal(failedStatus.json().data.canRetry, true);

    const retried = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-test-versions/${setup.tested.id}/preview`
    });
    assert.equal(retried.statusCode, 202, retried.body);
    assert.equal(retried.json().data.retried, true);
    assert.equal(retried.json().data.request.requestAttempt, 2);

    const spaces = new SpaceRegistry(setup.store);
    const other = spaces.createSpace(
      { key: "other-preview-api", name: "Другое пространство" },
      context("corr-other", 2)
    );
    const hidden = await setup.app.inject({
      method: "GET",
      url: `/api/v1/spaces/${other.id}/template-previews/${requestId}`
    });
    assert.equal(hidden.statusCode, 404, hidden.body);
  } finally {
    await setup.cleanup();
  }
});
