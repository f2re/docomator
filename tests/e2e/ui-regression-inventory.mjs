import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";

export const CANONICAL_UI_VIEWS = Object.freeze([
  Object.freeze({ view: "overview", label: "Главная", tier: "primary" }),
  Object.freeze({ view: "employees", label: "Сотрудники", tier: "primary" }),
  Object.freeze({ view: "entities", label: "Объекты", tier: "primary" }),
  Object.freeze({ view: "templates", label: "Шаблоны", tier: "primary" }),
  Object.freeze({ view: "gost-formatting", label: "Форматирование по ГОСТ", tier: "primary" }),
  Object.freeze({ view: "generation", label: "Создать документы", tier: "primary" }),
  Object.freeze({ view: "documents", label: "Результаты", tier: "primary" }),
  Object.freeze({ view: "automations", label: "Расписания", tier: "primary" }),
  Object.freeze({ view: "settings", label: "Настройки", tier: "primary" }),
  Object.freeze({ view: "publications", label: "Публикации", tier: "primary" }),
  Object.freeze({ view: "help", label: "Руководство", tier: "primary" }),
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

function databaseColumns() {
  return [
    { name: "id", type: "TEXT", notNull: true, primaryKeyPosition: 1 },
    { name: "display_name", type: "TEXT", notNull: true, primaryKeyPosition: 0 },
    { name: "status", type: "TEXT", notNull: true, primaryKeyPosition: 0 }
  ];
}

async function installDatabaseRegressionScenario(page) {
  await page.route("**/api/v1/admin/database/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }

    if (url.pathname === "/api/v1/admin/database/tables") {
      await fulfillJson(route, [
        {
          name: "entities",
          rowCount: 2,
          columns: databaseColumns(),
          label: "Объекты и сотрудники",
          category: "Основные данные",
          description: "Карточки людей и других объектов текущего контура.",
          sensitivity: "personal"
        }
      ]);
      return;
    }

    if (url.pathname === "/api/v1/admin/database/tables/entities/rows") {
      await fulfillJson(route, {
        table: "entities",
        presentation: {
          label: "Объекты и сотрудники",
          category: "Основные данные",
          description: "Карточки людей и других объектов текущего контура.",
          sensitivity: "personal"
        },
        columns: databaseColumns(),
        rows: [
          { id: "entity-1", display_name: "Смирнов Сергей Сергеевич", status: "active" },
          { id: "entity-2", display_name: "Петрова Анна Игоревна", status: "active" }
        ],
        total: 2,
        limit: 50,
        offset: 0,
        sortColumn: "id",
        sortDirection: "asc",
        search: ""
      });
      return;
    }

    if (url.pathname === "/api/v1/admin/database/check") {
      await fulfillJson(route, {
        status: "ok",
        messages: ["ok"],
        foreignKeyErrors: 0
      });
      return;
    }

    await route.fallback();
  });
}

export async function installUiRegressionScenario(page) {
  const state = await installОформляторApiMock(page, {
    employeeCount: 3,
    activeTemplate: true
  });

  await page.route("**/api/v1/document-formatting/profiles", (route) =>
    fulfillJson(route, [
      {
        id: "gost-r-7.0.97-2025",
        label: "ГОСТ Р 7.0.97-2025",
        scope: "Базовое оформление организационно-распорядительного DOCX; параметры остаются редактируемыми.",
        settings: {
          profile: "gost-r-7.0.97-2025",
          fontFamily: "Times New Roman",
          fontSizePt: 14,
          lineSpacing: 1.5,
          firstLineIndentMm: 12.5,
          marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
          bodyAlignment: "both"
        }
      },
      {
        id: "eskd-gost-r-2.105-2019",
        label: "ЕСКД — ГОСТ Р 2.105-2019",
        scope: "Базовое оформление текстового DOCX ЕСКД без синтеза рамок и основных надписей.",
        settings: {
          profile: "eskd-gost-r-2.105-2019",
          fontFamily: "Times New Roman",
          fontSizePt: 14,
          lineSpacing: 1.5,
          firstLineIndentMm: 12.5,
          marginsMm: { top: 20, right: 10, bottom: 20, left: 20 },
          bodyAlignment: "both"
        }
      }
    ])
  );
  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/publications\/config(?:\?.*)?$/u,
    (route) => fulfillJson(route, null)
  );
  await page.route(
    /\/api\/v1\/spaces\/[^/]+\/publications\/reports\/snapshots(?:\?.*)?$/u,
    (route) => fulfillJson(route, [])
  );
  await installDatabaseRegressionScenario(page);

  return state;
}
