import assert from "node:assert/strict";
import test from "node:test";
import type { CommonConfig } from "@docomator/config";

import {
  endpointFor,
  extractJsonObject,
  chatCompletionWithLlm
} from "./llm-client.js";
import { diagnoseLlm } from "./diagnostics.js";
import { diagnoseError } from "./error-diagnostics.js";
import { suggestMappings } from "./mapping-automation.js";
import { fillMissingValues } from "./filling-automation.js";

const baseConfig: CommonConfig = {
  version: "0.7.7",
  dataDir: "/tmp",
  logLevel: "info",
  llmEnabled: true,
  llmBaseUrl: "http://192.168.1.50:8081/v1/",
  llmApiKey: "test-token",
  llmModel: "test-model",
  llmTimeoutMs: 5000,
  llmTemperature: 0.1
};

test("endpointFor cleans trailing slashes and /v1", () => {
  assert.equal(endpointFor("http://127.0.0.1:8081/v1/"), "http://127.0.0.1:8081");
  assert.equal(endpointFor("http://192.168.1.50:8081///"), "http://192.168.1.50:8081");
  assert.equal(endpointFor("https://llm.example.corp/v1"), "https://llm.example.corp");
  assert.equal(endpointFor("not-a-url"), null);
  assert.equal(endpointFor("ftp://invalid.com"), null);
});

test("extractJsonObject extracts from raw and fenced markdown", () => {
  assert.deepEqual(extractJsonObject('{"a": 1}'), { a: 1 });
  assert.deepEqual(extractJsonObject('```json\n{"b": "test"}\n```'), { b: "test" });
  assert.deepEqual(extractJsonObject('Пояснение:\n```\n{"c": true}\n```'), { c: true });
  assert.equal(extractJsonObject("not json"), null);
  assert.equal(extractJsonObject("[1, 2]"), null);
});

test("chatCompletionWithLlm respects disabled state", async () => {
  const result = await chatCompletionWithLlm({
    config: { ...baseConfig, llmEnabled: false },
    userPrompt: "test"
  });
  assert.equal(result.success, false);
  assert.equal(result.status, "disabled");
  assert.equal(result.error, "llm_disabled");
});

test("chatCompletionWithLlm sends correct request with auth and parses JSON", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};

  const mockFetch: typeof fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedHeaders = (init?.headers as Record<string, string>) || {};
    capturedBody = JSON.parse(String(init?.body || "{}"));
    return new Response(
      JSON.stringify({
        model: "test-model",
        choices: [{ message: { content: '{"result": "ok"}' }, finish_reason: "stop" }]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const result = await chatCompletionWithLlm({
    config: baseConfig,
    systemPrompt: "sys",
    userPrompt: "usr",
    fetchImpl: mockFetch
  });

  assert.equal(result.success, true);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.json, { result: "ok" });
  assert.equal(capturedUrl, "http://192.168.1.50:8081/v1/chat/completions");
  assert.equal(capturedHeaders.authorization, "Bearer test-token");
  assert.equal(capturedBody.model, "test-model");
});

test("diagnoseLlm returns ready status for healthy server", async () => {
  const mockFetch: typeof fetch = async (url) => {
    const s = String(url);
    if (s.endsWith("/health")) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }
    if (s.endsWith("/v1/models")) {
      return new Response(JSON.stringify({ data: [{ id: "test-model" }] }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  };

  const status = await diagnoseLlm(baseConfig, { fetchImpl: mockFetch });
  assert.equal(status.status, "ready");
  assert.equal(status.enabled, true);
  assert.equal(status.model, "test-model");
  assert.deepEqual(status.availableModels, ["test-model"]);
});

test("diagnoseLlm returns unavailable when server is unreachable", async () => {
  const mockFetch: typeof fetch = async () => {
    throw new Error("connect ECONNREFUSED");
  };

  const status = await diagnoseLlm(baseConfig, { fetchImpl: mockFetch });
  assert.equal(status.status, "unavailable");
  assert.equal(status.enabled, true);
  assert.equal(status.reason, "request_failed");
});

test("diagnoseError falls back smoothly when LLM is unreachable", async () => {
  const mockFetch: typeof fetch = async () => {
    throw new Error("network error");
  };

  const diagnosis = await diagnoseError(
    baseConfig,
    {
      errorCode: "mapping_invalid",
      errorMessage: "Свойство устойчивого ключа должно быть сопоставлено с выбранной колонкой",
      stage: "import"
    },
    { fetchImpl: mockFetch }
  );

  assert.equal(diagnosis.status, "fallback");
  assert.equal(diagnosis.source, "heuristic");
  assert.match(diagnosis.explanationRu, /устойчивого идентификатора/);
  assert.match(diagnosis.suggestedActionRu, /поиска прежней записи/);
});

test("diagnoseError produces structured autoFix with live LLM response", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        model: "test-model",
        choices: [
          {
            message: {
              content: JSON.stringify({
                explanationRu: "Обнаружена некорректная колонка",
                suggestedActionRu: "Примените исправление сопоставления",
                autoFix: {
                  applicable: true,
                  descriptionRu: "Переназначить колонку",
                  columnMappings: { "Ф.И.О.": "fullName" },
                  retryRecommended: true
                }
              })
            }
          }
        ]
      }),
      { status: 200 }
    );

  const diagnosis = await diagnoseError(
    baseConfig,
    {
      errorCode: "mapping_invalid",
      errorMessage: "Ошибка сопоставления",
      stage: "import"
    },
    { fetchImpl: mockFetch }
  );

  assert.equal(diagnosis.status, "success");
  assert.equal(diagnosis.source, "llm");
  assert.equal(diagnosis.autoFix?.applicable, true);
  assert.equal(diagnosis.autoFix?.columnMappings?.["Ф.И.О."], "fullName");
});

test("suggestMappings suggests column mapping rules and falls back on failure", async () => {
  // Test fallback heuristics
  const fallback = await suggestMappings(
    { ...baseConfig, llmEnabled: false },
    {
      headers: ["ФИО сотрудника", "Подразделение", "Неизвестное поле"],
      targetProperties: [
        { key: "fullName", label: "ФИО сотрудника" },
        { key: "department", label: "Подразделение", aliases: ["Отдел"] }
      ]
    }
  );

  assert.equal(fallback.status, "fallback");
  assert.equal(fallback.source, "heuristic");
  assert.equal(fallback.mappings[0]?.column, "ФИО сотрудника");
  assert.equal(fallback.mappings[0]?.propertyKey, "fullName");
  assert.equal(fallback.mappings[1]?.column, "Подразделение");
  assert.equal(fallback.mappings[1]?.propertyKey, "department");
  assert.equal(fallback.mappings[2]?.propertyKey, null);

  // Test LLM response
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        model: "test-model",
        choices: [
          {
            message: {
              content: JSON.stringify({
                mappings: [
                  {
                    column: "ФИО сотрудника",
                    propertyKey: "fullName",
                    confidence: 0.99,
                    rationaleRu: "Полное имя",
                    suggestedType: "string"
                  }
                ]
              })
            }
          }
        ]
      }),
      { status: 200 }
    );

  const llmResult = await suggestMappings(
    baseConfig,
    {
      headers: ["ФИО сотрудника"],
      targetProperties: [{ key: "fullName", label: "ФИО сотрудника" }]
    },
    { fetchImpl: mockFetch }
  );

  assert.equal(llmResult.status, "success");
  assert.equal(llmResult.source, "llm");
  assert.equal(llmResult.mappings[0]?.propertyKey, "fullName");
  assert.equal(llmResult.mappings[0]?.confidence, 0.99);
});

test("fillMissingValues auto-fills values and falls back gracefully", async () => {
  // Test fallback derivation
  const fallback = await fillMissingValues(
    { ...baseConfig, llmEnabled: false },
    {
      templateTitle: "Приказ",
      entityName: "Петров Петр Петрович",
      existingValues: { fullName: "Петров Петр Петрович" },
      missingFields: [
        { key: "short_name", label: "Инициалы" },
        { key: "custom_note", label: "Служебная записка" }
      ]
    }
  );

  assert.equal(fallback.status, "fallback");
  assert.equal(fallback.filledValues["short_name"], "Петров П.П.");
  assert.equal("custom_note" in fallback.filledValues, false);

  // Test LLM filling
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        model: "test-model",
        choices: [
          {
            message: {
              content: JSON.stringify({
                rationaleRu: "Заполнен город и сокращённое имя",
                filledValues: {
                  short_name: "Петров П.П.",
                  city: "г. Москва"
                },
                details: [
                  { propertyKey: "city", value: "г. Москва", rationaleRu: "Место издания приказа" }
                ]
              })
            }
          }
        ]
      }),
      { status: 200 }
    );

  const llmResult = await fillMissingValues(
    baseConfig,
    {
      templateTitle: "Приказ",
      entityName: "Петров Петр Петрович",
      missingFields: [
        { key: "short_name", label: "Инициалы" },
        { key: "city", label: "Город" }
      ]
    },
    { fetchImpl: mockFetch }
  );

  assert.equal(llmResult.status, "success");
  assert.equal(llmResult.source, "llm");
  assert.equal(llmResult.filledValues["city"], "г. Москва");
  assert.equal(llmResult.details[0]?.propertyKey, "city");
});
