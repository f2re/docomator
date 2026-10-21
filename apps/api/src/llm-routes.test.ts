import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "@docomator/config";
import { SqliteStore } from "@docomator/storage";
import { buildApp } from "./app.js";

function migratedFixture(): {
  directory: string;
  store: SqliteStore;
  cleanup: () => void;
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docomator-api-llm-routes-"));
  const databasePath = path.join(directory, "docomator.db");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDirectory = path.resolve(currentDirectory, "../../../migrations");
  for (const migration of fs
    .readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    database.exec(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
  }
  database.close();
  const store = new SqliteStore({ databasePath });
  return {
    directory,
    store,
    cleanup: () => {
      store.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

test("LLM routes suite", async (t) => {
  const fixture = migratedFixture();
  const config = loadApiConfig({
    DOCOMATOR_DATA_DIR: fixture.directory,
    DOCOMATOR_LOG_LEVEL: "fatal",
    DOCOMATOR_LLM_ENABLED: "false"
  });
  const app = buildApp(config, { store: fixture.store });

  // Create a test space
  const createSpaceRes = await app.inject({
    method: "POST",
    url: "/api/v1/spaces",
    payload: { key: "test-space", name: "Тестовое пространство" }
  });
  assert.equal(createSpaceRes.statusCode, 201);
  const spaceId = (createSpaceRes.json() as { data: { id: string } }).data.id;

  await t.test("GET /api/v1/llm/status reports disabled when config.llmEnabled is false", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/llm/status" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { data: { status: string; enabled: boolean } };
    assert.equal(body.data.status, "disabled");
    assert.equal(body.data.enabled, false);
  });

  await t.test("GET /api/v1/spaces/:spaceId/llm/status reports status scoped to space", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/spaces/${spaceId}/llm/status` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { data: { status: string; enabled: boolean } };
    assert.equal(body.data.status, "disabled");
  });

  await t.test("POST /api/v1/spaces/:spaceId/llm/diagnose-error analyzes error with fallback heuristics", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/llm/diagnose-error`,
      payload: {
        errorCode: "mapping_duplicate_target",
        errorMessage: "Свойство устойчивого ключа сопоставлено более одного раза.",
        stage: "import"
      }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { data: { status: string; source: string; explanationRu: string; suggestedActionRu: string } };
    assert.equal(body.data.status, "fallback");
    assert.equal(body.data.source, "heuristic");
    assert.match(body.data.explanationRu, /Одно и то же свойство/);
    assert.match(body.data.suggestedActionRu, /оставьте свойство/i);
  });

  await t.test("POST /api/v1/spaces/:spaceId/llm/suggest-mappings returns suggested mappings", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/llm/suggest-mappings`,
      payload: {
        headers: ["ФИО", "Подразделение", "Неизвестно"],
        targetProperties: [
          { key: "fullName", label: "ФИО" },
          { key: "department", label: "Подразделение" }
        ]
      }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { data: { status: string; source: string; mappings: Array<{ propertyKey: string | null }> } };
    assert.equal(body.data.status, "fallback");
    assert.equal(body.data.source, "heuristic");
    assert.equal(body.data.mappings.length, 3);
    assert.equal(body.data.mappings[0]?.propertyKey, "fullName");
    assert.equal(body.data.mappings[1]?.propertyKey, "department");
    assert.equal(body.data.mappings[2]?.propertyKey, null);
  });

  await t.test("POST /api/v1/spaces/:spaceId/llm/fill-values returns filled values", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/llm/fill-values`,
      payload: {
        templateTitle: "Приказ",
        entityName: "Сидоров Сидор Сидорович",
        missingFields: [
          { key: "short_name", label: "Инициалы" }
        ]
      }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { data: { status: string; filledValues: Record<string, string> } };
    assert.equal(body.data.status, "fallback");
    assert.equal(body.data.filledValues["short_name"], "Сидоров С.С.");
  });

  await t.test("POST /api/v1/llm/test handles disabled LLM safely", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/llm/test",
      payload: { prompt: "Тестовая проверка" }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { data: { success: boolean; status: string } };
    assert.equal(body.data.success, false);
    assert.equal(body.data.status, "disabled");
  });

  await t.test("POST /api/v1/spaces/:spaceId/llm/test handles space-level test prompt", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/spaces/${spaceId}/llm/test`,
      payload: { prompt: "Тестовая проверка" }
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { data: { success: boolean; status: string } };
    assert.equal(body.data.success, false);
    assert.equal(body.data.status, "disabled");
  });

  await t.test("LLM endpoints reject non-existent space", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/spaces/non-existent-space/llm/diagnose-error",
      payload: { errorMessage: "Test error" }
    });
    assert.equal(res.statusCode, 404);
  });

  await app.close();
  fixture.cleanup();
});
