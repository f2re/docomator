import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";

export const CANONICAL_UI_VIEWS = Object.freeze([
  Object.freeze({ view: "overview", label: "Главная", tier: "primary" }),
  Object.freeze({ view: "employees", label: "Сотрудники", tier: "primary" }),
  Object.freeze({ view: "entities", label: "Объекты", tier: "primary" }),
  Object.freeze({ view: "templates", label: "Шаблоны", tier: "primary" }),
  Object.freeze({ view: "generation", label: "Создать документы", tier: "primary" }),
  Object.freeze({ view: "documents", label: "Результаты", tier: "primary" }),
  Object.freeze({ view: "automations", label: "Расписания", tier: "primary" }),
  Object.freeze({ view: "settings", label: "Настройки", tier: "primary" }),
  Object.freeze({ view: "publications", label: "Публикации", tier: "primary" }),
  Object.freeze({ view: "spaces", label: "Пространства", tier: "advanced" }),
  Object.freeze({ view: "knowledge", label: "Типы и свойства", tier: "advanced" }),
  Object.freeze({ view: "database", label: "Администрирование БД", tier: "advanced" })
]);

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-correlation-id": "ui-regression-e2e"
};

function fulfillJson(route, data) {
  return route.fulfill({
    status: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({ data, correlationId: "ui-regression-e2e" })
  });
}

export async function installUiRegressionScenario(page) {
  const state = await installDocomatorApiMock(page, {
    employeeCount: 3,
    activeTemplate: true
  });

  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/publications\/config(?:\?.*)?$/u,
    (route) => fulfillJson(route, null)
  );
  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/publications\/reports\/snapshots(?:\?.*)?$/u,
    (route) => fulfillJson(route, [])
  );

  return state;
}
