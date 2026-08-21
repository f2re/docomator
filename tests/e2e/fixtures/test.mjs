import { readFile } from "node:fs/promises";

import { expect, test as base } from "@playwright/test";

import { installОформляторApiMock } from "./docomator-api.mjs";

const bundledAcceptance = import.meta.url.includes("/payload/acceptance/ux/");
const inventoryUrl = bundledAcceptance
  ? new URL("../../../../../app/scripts/runtime/ux-ui-inventory.mjs", import.meta.url)
  : new URL("../../../scripts/runtime/ux-ui-inventory.mjs", import.meta.url);
const inventory = await import(inventoryUrl.href);

export const CANONICAL_UI_VIEWS = inventory.CANONICAL_UI_VIEWS;
export const CANONICAL_UI_STATES = inventory.CANONICAL_UI_STATES;
export const canonicalUiState = inventory.canonicalUiState;
export const canonicalViewAxeTitle = inventory.canonicalViewAxeTitle;
export const canonicalStateTestTitle = inventory.canonicalStateTestTitle;
export const UI_REGRESSION_INVENTORY_VERSION =
  inventory.UI_REGRESSION_INVENTORY_VERSION;

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

export async function installUiRegressionScenario(page, options = {}) {
  const state = await installОформляторApiMock(page, {
    employeeCount: 3,
    activeTemplate: true,
    ...options
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

const test = base.extend({
  accessPasswordSession: [
    async ({ baseURL, page }, use) => {
      const passwordFile = process.env.DOCOMATOR_E2E_ACCESS_PASSWORD_FILE;
      if (passwordFile) {
        const password = (await readFile(passwordFile, "utf8")).replace(/\r?\n$/u, "");
        const origin = new URL(baseURL || "http://127.0.0.1:18080").origin;
        const response = await page.request.post(`${origin}/api/v1/auth/login`, {
          headers: {
            accept: "application/json",
            origin
          },
          data: { password }
        });
        expect(
          response.status(),
          "offline UX-приёмка не смогла войти по общему паролю Оформлятор"
        ).toBe(200);
      }
      await use();
    },
    { auto: true }
  ],
  externalOriginGuard: [
    async ({ baseURL, page }, use) => {
      const allowedOrigin = new URL(
        baseURL || "http://127.0.0.1:18080"
      ).origin;
      const externalRequests = [];
      const runtimeErrors = [];
      const inspectRequest = (request) => {
        const url = new URL(request.url());
        if (
          (url.protocol === "http:" || url.protocol === "https:") &&
          url.origin !== allowedOrigin
        ) {
          externalRequests.push(`${request.method()} ${request.url()}`);
        }
      };
      const inspectPageError = (error) => {
        runtimeErrors.push(error.stack || error.message || String(error));
      };
      page.on("request", inspectRequest);
      page.on("pageerror", inspectPageError);
      await use(externalRequests);
      page.off("request", inspectRequest);
      page.off("pageerror", inspectPageError);
      expect(
        externalRequests,
        `интерфейс обращался за пределы локального origin ${allowedOrigin}`
      ).toEqual([]);
      expect(runtimeErrors, "в UI возникли необработанные ошибки JavaScript").toEqual(
        []
      );
    },
    { auto: true }
  ]
});

export { expect, test };
