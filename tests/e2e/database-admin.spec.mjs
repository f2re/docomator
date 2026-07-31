import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const tablePresentations = {
  entities: {
    label: "Объекты и сотрудники",
    category: "Основные данные",
    description: "Карточки людей и других объектов, доступных в разделах Docomator.",
    sensitivity: "personal"
  },
  audit_log: {
    label: "Журнал действий",
    category: "Диагностика",
    description: "Технический журнал операций и идентификаторов корреляции.",
    sensitivity: "restricted"
  }
};

async function installDatabaseAdminMock(page) {
  const state = {
    rowRequests: [],
    propertyBodies: [],
    exports: []
  };

  await page.route("**/api/v1/admin/database/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const headers = {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-correlation-id": "database-admin-e2e"
    };

    if (path === "/api/v1/admin/database/tables" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          data: [
            {
              name: "entities",
              rowCount: 2,
              columns: [
                { name: "id", type: "TEXT", notNull: true, primaryKeyPosition: 1 },
                { name: "display_name", type: "TEXT", notNull: true, primaryKeyPosition: 0 },
                { name: "status", type: "TEXT", notNull: true, primaryKeyPosition: 0 }
              ],
              ...tablePresentations.entities
            },
            {
              name: "audit_log",
              rowCount: 1,
              columns: [
                { name: "id", type: "INTEGER", notNull: true, primaryKeyPosition: 1 },
                { name: "action", type: "TEXT", notNull: true, primaryKeyPosition: 0 }
              ],
              ...tablePresentations.audit_log
            }
          ]
        })
      });
      return;
    }

    const rowsMatch = path.match(
      /^\/api\/v1\/admin\/database\/tables\/([^/]+)\/rows$/u
    );
    if (rowsMatch && method === "GET") {
      const table = decodeURIComponent(rowsMatch[1]);
      state.rowRequests.push({ table, search: url.searchParams.get("search") || "" });
      if (table === "audit_log") await new Promise((resolve) => setTimeout(resolve, 180));
      const search = url.searchParams.get("search") || "";
      const rows =
        table === "audit_log"
          ? [{ id: 1, action: "export" }]
          : [
              { id: "entity-1", display_name: "Смирнов Сергей Сергеевич", status: "active" },
              { id: "entity-2", display_name: "Петрова Анна Игоревна", status: "active" }
            ].filter((row) =>
              search
                ? row.display_name.toLocaleLowerCase("ru-RU").includes(
                    search.toLocaleLowerCase("ru-RU")
                  )
                : true
            );
      const columns =
        table === "audit_log"
          ? [
              { name: "id", type: "INTEGER", notNull: true, primaryKeyPosition: 1 },
              { name: "action", type: "TEXT", notNull: true, primaryKeyPosition: 0 }
            ]
          : [
              { name: "id", type: "TEXT", notNull: true, primaryKeyPosition: 1 },
              { name: "display_name", type: "TEXT", notNull: true, primaryKeyPosition: 0 },
              { name: "status", type: "TEXT", notNull: true, primaryKeyPosition: 0 }
            ];
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          data: {
            table,
            presentation: tablePresentations[table],
            columns,
            rows,
            total: rows.length,
            limit: Number(url.searchParams.get("limit") || 50),
            offset: Number(url.searchParams.get("offset") || 0),
            sortColumn: url.searchParams.get("sortColumn") || "id",
            sortDirection: url.searchParams.get("sortDirection") || "asc",
            search
          }
        })
      });
      return;
    }

    const exportMatch = path.match(
      /^\/api\/v1\/admin\/database\/tables\/([^/]+)\/export$/u
    );
    if (exportMatch && method === "GET") {
      const table = decodeURIComponent(exportMatch[1]);
      const format = url.searchParams.get("format") === "json" ? "json" : "csv";
      state.exports.push({ table, format });
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type":
            format === "json"
              ? "application/json; charset=utf-8"
              : "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${table}.${format}"`
        },
        body: format === "json" ? "[]\n" : "\ufeff\"id\"\n\"entity-1\"\n"
      });
      return;
    }

    if (path === "/api/v1/admin/database/check" && method === "GET") {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          data: { status: "ok", messages: ["ok"], foreignKeyErrors: 0 }
        })
      });
      return;
    }

    if (path === "/api/v1/admin/database/properties" && method === "POST") {
      const body = request.postDataJSON();
      state.propertyBodies.push(body);
      await route.fulfill({
        status: 201,
        headers,
        body: JSON.stringify({
          data: {
            key: "person.inventory_number",
            ...body,
            version: 1
          }
        })
      });
      return;
    }

    await route.fulfill({
      status: 404,
      headers,
      body: JSON.stringify({ error: { message: "Маршрут не найден." } })
    });
  });

  return state;
}

async function setEnhancedSelect(page, selector, value) {
  await page.locator(selector).selectOption(value, { force: true });
}

async function openDatabaseAdmin(page) {
  await installDocomatorApiMock(page, {
    entityTypes: [
      { key: "person", label: "Человек", description: "Сотрудник" },
      { key: "equipment", label: "Оборудование", description: "Инвентарь" }
    ]
  });
  const admin = await installDatabaseAdminMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("settings");
  await page.locator('[data-view-target="database"]').click();
  await expect(page.locator("#databaseAdminTable")).toBeAttached();
  await expect(
    page.locator("#databaseAdminTable + [data-searchable-select-root] .searchable-select-trigger")
  ).toBeVisible();
  await expect(page.locator("#databaseAdminContext")).toContainText(
    "Объекты и сотрудники"
  );
  return { app, admin };
}

test("панель базы сохраняет поиск, отклоняет устаревший ответ и открывает строку", async ({
  page
}) => {
  const { admin } = await openDatabaseAdmin(page);

  const search = page.locator("#databaseAdminSearch");
  await search.fill("Смирнов");
  await search.press("Enter");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Смирнов");
  await expect(page.locator(".database-admin-table tbody")).toContainText(
    "Смирнов Сергей Сергеевич"
  );
  await expect(page.locator(".database-admin-table tbody")).not.toContainText(
    "Петрова Анна Игоревна"
  );

  await setEnhancedSelect(page, "#databaseAdminTable", "audit_log");
  await setEnhancedSelect(page, "#databaseAdminTable", "entities");
  await expect(page.locator("#databaseAdminContext")).toContainText(
    "Объекты и сотрудники"
  );
  await expect(page.locator(".database-admin-table tbody")).not.toContainText(
    "export"
  );

  await page.locator('[data-db-admin-row="0"]').click();
  await expect(page.locator("#databaseAdminRowDialog")).toBeVisible();
  await expect(page.locator("#databaseAdminRowValues")).toContainText(
    "display_name"
  );
  await expect(page.locator("#databaseAdminRowValues")).toContainText(
    "Смирнов Сергей Сергеевич"
  );
  await page.locator("#databaseAdminRowDialog .primary-button").click();

  expect(admin.rowRequests.some((request) => request.search === "Смирнов")).toBe(
    true
  );
});

test("панель создаёт типизированное поле и журналируемо выгружает таблицу", async ({
  page
}) => {
  const { admin } = await openDatabaseAdmin(page);

  await page.locator('[data-db-admin-action="property"]').click();
  await page.locator("#databaseAdminPropertyLabel").fill("Инвентарный номер");
  await page.locator("#databaseAdminPropertyType").selectOption("enum");
  await setEnhancedSelect(
    page,
    "#databaseAdminPropertyEntityType",
    "equipment"
  );
  await page
    .locator("#databaseAdminPropertyCardinality")
    .selectOption("multiple");
  await page
    .locator("#databaseAdminPropertyAliases")
    .fill("инв. номер\nномер имущества\nинв. номер");
  await page.locator("#databaseAdminPropertyEnum").fill("А-001\nА-002");
  await page.locator("#databaseAdminPropertySubmit").click();
  await expect(page.locator("#databaseAdminPropertyDialog")).not.toBeVisible();

  expect(admin.propertyBodies).toHaveLength(1);
  expect(admin.propertyBodies[0]).toMatchObject({
    label: "Инвентарный номер",
    valueType: "enum",
    cardinality: "multiple",
    appliesTo: ["equipment"],
    aliases: ["инв. номер", "номер имущества"],
    validation: { enum: ["А-001", "А-002"] }
  });

  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-db-admin-export="csv"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("entities.csv");
  expect(admin.exports).toEqual([{ table: "entities", format: "csv" }]);

  await page.locator('[data-db-admin-action="check"]').click();
  await expect(page.locator("#databaseAdminCheck")).toContainText(
    "Целостность SQLite и внешние ключи в порядке"
  );
});
