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
  for (const migration of fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.close();
}

function sourceDocx(): Buffer {
  return buildZipFixture(
    minimalDocxEntries().map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            content:
              '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>№</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>ФИО</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>'
          }
        : entry
    )
  );
}

async function testApp() {
  const dataDir = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "docomator-template-field-edit-")
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

test("API safely updates, remaps and removes fields of a repeat row", async () => {
  const { app, dataDir } = await testApp();
  try {
    const sourceResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/quarantine?fileName=${encodeURIComponent("Список.docx")}`,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      payload: sourceDocx()
    });
    assert.equal(sourceResponse.statusCode, 201, sourceResponse.body);
    const source = sourceResponse.json().data as { id: string };

    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/document-sources/${source.id}/draft`,
      headers: { "content-type": "application/json" },
      payload: { title: "Список студентов" }
    });
    assert.equal(draftResponse.statusCode, 201, draftResponse.body);
    const draft = draftResponse.json().data as {
      id: string;
      structure: {
        elements: Array<{
          id: string;
          kind: string;
          tableLocation?: { rowIndex: number; columnIndex: number };
        }>;
      };
    };
    const numberCell = draft.structure.elements.find(
      (element) =>
        element.kind === "paragraph" &&
        element.tableLocation?.rowIndex === 1 &&
        element.tableLocation.columnIndex === 0
    );
    const nameCell = draft.structure.elements.find(
      (element) =>
        element.kind === "paragraph" &&
        element.tableLocation?.rowIndex === 1 &&
        element.tableLocation.columnIndex === 1
    );
    assert.ok(numberCell);
    assert.ok(nameCell);

    const numberResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "subject.position",
        label: "Номер строки",
        valueType: "integer",
        required: true,
        elementId: numberCell.id,
        repeatRow: true
      }
    });
    assert.equal(numberResponse.statusCode, 201, numberResponse.body);
    const numberField = numberResponse.json().data.field as { id: string };

    const nameResponse = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "subject.display_name_2",
        label: "ФИО участника",
        valueType: "string",
        required: false,
        elementId: nameCell.id,
        personName: {
          sourceOrder: "family-given-patronymic",
          pattern: "{Фамилия} {Имя} {Отчество}"
        }
      }
    });
    assert.equal(nameResponse.statusCode, 201, nameResponse.body);
    const nameField = nameResponse.json().data.field as { id: string };

    const conflict = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields/${nameField.id}`,
      headers: { "content-type": "application/json" },
      payload: {
        key: "subject.position",
        label: "Дубликат",
        valueType: "integer",
        required: false
      }
    });
    assert.equal(conflict.statusCode, 409, conflict.body);

    const update = await app.inject({
      method: "PUT",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields/${nameField.id}`,
      headers: {
        "content-type": "application/json",
        "x-correlation-id": "corr-row-edit"
      },
      payload: {
        key: "subject.display_name_2",
        label: "ФИО студента",
        valueType: "string",
        required: true,
        personName: {
          sourceOrder: "family-given-patronymic",
          pattern: "{Фамилия} {И}.{О}."
        }
      }
    });
    assert.equal(update.statusCode, 200, update.body);
    assert.equal(update.json().data.field.label, "ФИО студента");
    assert.equal(update.json().data.field.required, true);
    assert.deepEqual(update.json().data.field.formatter, {
      version: 1,
      kind: "person-name.ru",
      sourceOrder: "family-given-patronymic",
      pattern: "{Фамилия} {И}.{О}."
    });

    const deleteName = await app.inject({
      method: "DELETE",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields/${nameField.id}`
    });
    assert.equal(deleteName.statusCode, 200, deleteName.body);
    assert.deepEqual(deleteName.json().data, {
      fieldId: nameField.id,
      remainingFieldCount: 1,
      repeatBindingCleared: false
    });

    const deleteNumber = await app.inject({
      method: "DELETE",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}/fields/${numberField.id}`
    });
    assert.equal(deleteNumber.statusCode, 200, deleteNumber.body);
    assert.deepEqual(deleteNumber.json().data, {
      fieldId: numberField.id,
      remainingFieldCount: 0,
      repeatBindingCleared: true
    });

    const finalDraft = await app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-drafts/${draft.id}`
    });
    assert.equal(finalDraft.statusCode, 200, finalDraft.body);
    assert.equal(finalDraft.json().data.fields.length, 0);
    assert.equal(finalDraft.json().data.repeatBinding, null);
  } finally {
    await app.close();
    await fsPromises.rm(dataDir, { recursive: true, force: true });
  }
});
