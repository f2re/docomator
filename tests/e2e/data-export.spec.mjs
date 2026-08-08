import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const entityTypes = [
  { key: "person", label: "Человек", description: "Сотрудник" },
  { key: "room", label: "Аудитория", description: "Учебное помещение" }
];

const properties = [
  {
    key: "room.capacity",
    label: "Вместимость",
    valueType: "integer",
    sensitivity: "internal",
    appliesTo: ["room"],
    aliases: [],
    validation: {},
    unit: "мест"
  }
];

test("экспорт выбранного типа предлагает CSV и XLSX и скачивает файл пространства", async ({
  page
}) => {
  await installDocomatorApiMock(page, { entityTypes, properties });
  await page.route(/\/api\/v1\/spaces\/[^/]+\/data-export\.csv\?entityTypeKey=room$/u, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="docomator-test-room-2026-08-08.csv"',
        "x-docomator-export-count": "2"
      },
      body: '\uFEFF"Название";"Статус"\r\n"Аудитория 101";"Активен"\r\n'
    });
  });
  await page.route(/\/api\/v1\/spaces\/[^/]+\/data-export\.xlsx\?entityTypeKey=room$/u, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="docomator-test-room-2026-08-08.xlsx"',
        "x-docomator-export-count": "2"
      },
      body: Buffer.from("PK\u0003\u0004e2e-xlsx", "binary")
    });
  });

  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("entities");
  await expect(page.locator("#entityWorkspaceType")).toHaveValue("room");

  const csvButton = page.locator('[data-entity-export][data-export-format="csv"]');
  const xlsxButton = page.locator('[data-export-format="xlsx"]').filter({ hasText: "Экспорт XLSX" });
  await expect(csvButton).toBeVisible();
  await expect(csvButton).toHaveText("Экспорт CSV");
  await expect(xlsxButton).toBeVisible();

  const parentGeometry = await csvButton.locator("..").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(parentGeometry.scrollWidth).toBeLessThanOrEqual(parentGeometry.clientWidth + 2);

  const csvDownload = page.waitForEvent("download");
  await csvButton.click();
  expect((await csvDownload).suggestedFilename()).toBe("docomator-test-room-2026-08-08.csv");
  await expect(page.locator("[data-data-export-status]")).toContainText(
    "Экспортировано в CSV: 2"
  );

  const xlsxDownload = page.waitForEvent("download");
  await xlsxButton.click();
  expect((await xlsxDownload).suggestedFilename()).toBe("docomator-test-room-2026-08-08.xlsx");
  await expect(page.locator("[data-data-export-status]")).toContainText(
    "Экспортировано в XLSX: 2"
  );
});
