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
import { packageEntry, readOoxmlPackage } from "@docomator/template-compiler";
import { DEFAULT_SPACE_ID } from "@docomator/storage";

import { buildApp } from "./app.js";

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

async function testApp() {
  const dataDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-multi-field-api-")
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
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ФИО получателя</w:t></w:r></w:p><w:p><w:r><w:t>Должность получателя</w:t></w:r></w:p><w:p><w:r><w:t>Неизменяемый текст</w:t></w:r></w:p></w:body></w:document>'
          }
        : entry
    )
  );
}

async function createDraftWithFields(app: ReturnType<typeof buildApp>) {
  const source = await app.inject({
    method: "POST",
    url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/quarantine?fileName=${encodeURIComponent("Письмо.docx")}`,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    payload: sourceDocx()
  });
  assert.equal(source.statusCode, 201, source.body);
  const sourceId = source.json().data.id as string;

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

  const definitions = [
    {
      text: "ФИО получателя",
      key: "recipient.full_name",
      label: "ФИО получателя",
      valueType: "string"
    },
    {
      text: "Должность получателя",
      key: "recipient.position",
      label: "Должность получателя",
      valueType: "string"
    }
  ] as const;
  const fields: Array<{ id: string; key: string }> = [];
  for (const definition of definitions) {
    const element = draft.structure.elements.find(
      (candidate) =>
        candidate.kind === "paragraph" && candidate.text === definition.text
    );
    assert.ok(element);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: definition.key,
        label: definition.label,
        valueType: definition.valueType,
        required: true,
        elementId: element.id
      }
    });
    assert.equal(response.statusCode, 201, response.body);
    fields.push(response.json().data.field);
  }
  return { draftId: draft.id, fields };
}

test("API creates, reads and downloads a complete multi-field tested version", async () => {
  const { app, dataDir } = await testApp();
  try {
    const setup = await createDraftWithFields(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/trial-all`,
      headers: {
        "content-type": "application/json",
        "x-actor-id": "editor-1",
        "x-correlation-id": "corr-multi-api"
      },
      payload: {
        values: [
          { fieldId: setup.fields[1]?.id, value: "Ведущий инженер" },
          { fieldId: setup.fields[0]?.id, value: "Иванов Иван Иванович" }
        ]
      }
    });
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json() as {
      data: {
        version: {
          id: string;
          fieldCount: number;
          fields: Array<{
            fieldKey: string;
            renderedValue: string;
            readBackValue: string;
          }>;
        };
        verification: { fieldCount: number; allMatched: boolean };
        downloads: { compiled: string; trial: string };
      };
      correlationId: string;
    };
    assert.equal(body.data.version.fieldCount, 2);
    assert.equal(body.data.verification.allMatched, true);
    assert.equal(body.correlationId, "corr-multi-api");
    assert.deepEqual(
      body.data.version.fields.map((field) => [field.fieldKey, field.readBackValue]),
      [
        ["recipient.full_name", "Иванов Иван Иванович"],
        ["recipient.position", "Ведущий инженер"]
      ]
    );

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
    const compiledXml = packageEntry(
      await readOoxmlPackage(compiled.rawPayload),
      "word/document.xml"
    ).content.toString("utf8");
    const trialXml = packageEntry(
      await readOoxmlPackage(trial.rawPayload),
      "word/document.xml"
    ).content.toString("utf8");
    assert.equal((compiledXml.match(/aifield:/gu) ?? []).length, 2);
    assert.match(trialXml, /Иванов Иван Иванович/u);
    assert.match(trialXml, /Ведущий инженер/u);
    assert.match(trialXml, /Неизменяемый текст/u);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/multi-test-versions`
    });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().data.length, 1);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/trial-all`,
      headers: { "content-type": "application/json" },
      payload: {
        values: [
          { fieldId: setup.fields[0]?.id, value: "Иванов Иван Иванович" },
          { fieldId: setup.fields[1]?.id, value: "Ведущий инженер" }
        ]
      }
    });
    assert.equal(duplicate.statusCode, 201, duplicate.body);
    assert.equal(duplicate.json().data.version.id, body.data.version.id);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});

test("API rejects incomplete, duplicate and foreign field sets", async () => {
  const { app, dataDir } = await testApp();
  try {
    const setup = await createDraftWithFields(app);
    const incomplete = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/trial-all`,
      headers: { "content-type": "application/json" },
      payload: {
        values: [{ fieldId: setup.fields[0]?.id, value: "Иванов" }]
      }
    });
    assert.equal(incomplete.statusCode, 400, incomplete.body);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/trial-all`,
      headers: { "content-type": "application/json" },
      payload: {
        values: [
          { fieldId: setup.fields[0]?.id, value: "Иванов" },
          { fieldId: setup.fields[0]?.id, value: "Петров" }
        ]
      }
    });
    assert.equal(duplicate.statusCode, 400, duplicate.body);

    const foreign = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${setup.draftId}/trial-all`,
      headers: { "content-type": "application/json" },
      payload: {
        values: [
          { fieldId: setup.fields[0]?.id, value: "Иванов" },
          { fieldId: "foreign-field", value: "Инженер" }
        ]
      }
    });
    assert.equal(foreign.statusCode, 400, foreign.body);
    assert.match(foreign.json().error.message, /все поля черновика/ui);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});
