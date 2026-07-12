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
import { readOoxmlPackage, packageEntry } from "@docomator/template-compiler";
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
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.close();
}

async function testApp() {
  const dataDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-template-trial-api-")
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

function sourceDocx(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>ФИО получателя</w:t></w:r></w:p><w:p><w:r><w:t>Неизменяемый текст</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
}

async function createDraftAndField(app: ReturnType<typeof buildApp>) {
  const sourceResponse = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/quarantine?fileName=${encodeURIComponent("Письмо.docx")}`,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    payload: sourceDocx()
  });
  assert.equal(sourceResponse.statusCode, 201, sourceResponse.body);
  const sourceId = sourceResponse.json().data.id as string;

  const draftResponse = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${sourceId}/draft`,
    headers: { "content-type": "application/json" },
    payload: { title: "Официальное письмо" }
  });
  assert.equal(draftResponse.statusCode, 201, draftResponse.body);
  const draft = draftResponse.json().data as {
    id: string;
    structure: {
      elements: Array<{ id: string; kind: string; text: string }>;
    };
  };
  const element = draft.structure.elements.find(
    (candidate) => candidate.kind === "paragraph" && candidate.text === "ФИО получателя"
  );
  assert.ok(element);

  const fieldResponse = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
    headers: { "content-type": "application/json" },
    payload: {
      key: "recipient.full_name",
      label: "ФИО получателя",
      valueType: "string",
      required: true,
      elementId: element.id
    }
  });
  assert.equal(fieldResponse.statusCode, 201, fieldResponse.body);
  return {
    draftId: draft.id,
    fieldId: fieldResponse.json().data.field.id as string
  };
}

test("trial endpoint compiles, renders, reads back and stores immutable files", async () => {
  const { app, dataDir } = await testApp();
  try {
    const setup = await createDraftAndField(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/trial`,
      headers: {
        "content-type": "application/json",
        "x-actor-id": "editor-1",
        "x-correlation-id": "corr-trial-api"
      },
      payload: {
        fieldId: setup.fieldId,
        value: "Иванов Иван Иванович"
      }
    });
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json() as {
      data: {
        version: {
          id: string;
          versionNumber: number;
          compiledSha256: string;
          trialSha256: string;
          renderedValue: string;
          readBackValue: string;
        };
        verification: {
          matched: boolean;
          renderedValue: string;
          readBackValue: string;
        };
        downloads: { compiled: string; trial: string };
      };
      correlationId: string;
    };
    assert.equal(body.data.version.versionNumber, 1);
    assert.equal(body.data.version.renderedValue, "Иванов Иван Иванович");
    assert.equal(body.data.version.readBackValue, "Иванов Иван Иванович");
    assert.equal(body.data.verification.matched, true);
    assert.equal(body.correlationId, "corr-trial-api");

    const compiled = await app.inject({
      method: "GET",
      url: body.data.downloads.compiled
    });
    const trial = await app.inject({
      method: "GET",
      url: body.data.downloads.trial
    });
    assert.equal(compiled.statusCode, 200, compiled.body);
    assert.equal(trial.statusCode, 200, trial.body);
    assert.match(compiled.headers["content-disposition"] ?? "", /техническая-привязка/u);
    assert.match(trial.headers["content-disposition"] ?? "", /пробное-заполнение/u);

    const compiledEntries = await readOoxmlPackage(compiled.rawPayload);
    const trialEntries = await readOoxmlPackage(trial.rawPayload);
    const compiledXml = packageEntry(
      compiledEntries,
      "word/document.xml"
    ).content.toString("utf8");
    const trialXml = packageEntry(
      trialEntries,
      "word/document.xml"
    ).content.toString("utf8");
    assert.match(compiledXml, /aifield:/u);
    assert.match(compiledXml, /ФИО получателя/u);
    assert.match(trialXml, /Иванов Иван Иванович/u);
    assert.match(trialXml, /Неизменяемый текст/u);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/test-versions`
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().data.length, 1);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/trial`,
      headers: { "content-type": "application/json" },
      payload: {
        fieldId: setup.fieldId,
        value: "Иванов Иван Иванович"
      }
    });
    assert.equal(duplicate.statusCode, 201, duplicate.body);
    assert.equal(duplicate.json().data.version.id, body.data.version.id);

    const database = new DatabaseSync(path.join(dataDir, "docomator.db"));
    const eventCount = database
      .prepare(
        "SELECT COUNT(*) AS value FROM domain_events WHERE event_type = 'template.test-version.created'"
      )
      .get() as { value: number };
    database.close();
    assert.equal(Number(eventCount.value), 1);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});

test("trial endpoint rejects an unknown field and hides versions across spaces", async () => {
  const { app, dataDir } = await testApp();
  try {
    const setup = await createDraftAndField(app);
    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/trial`,
      headers: { "content-type": "application/json" },
      payload: { fieldId: "missing-field", value: "Иванов" }
    });
    assert.equal(missing.statusCode, 400, missing.body);
    assert.match(missing.json().error.message, /Поле шаблона.*не найдено/u);

    const versionResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/trial`,
      headers: { "content-type": "application/json" },
      payload: { fieldId: setup.fieldId, value: "Иванов" }
    });
    const versionId = versionResponse.json().data.version.id as string;
    const otherSpaceResponse = await app.inject({
      method: "POST",
      url: "/api/v1/spaces",
      headers: { "content-type": "application/json" },
      payload: { key: "other-trial", name: "Другое пространство" }
    });
    const otherSpaceId = otherSpaceResponse.json().data.id as string;
    const hidden = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${otherSpaceId}/template-test-versions/${versionId}`
    });
    assert.equal(hidden.statusCode, 404, hidden.body);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});
