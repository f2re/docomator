import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

test("оператор вставляет таблицу из Excel и проверяет предложенные поля", async ({ page }) => {
  const state = await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("employees");
  await page.locator("[data-bulk-import-open]:visible").first().click();

  await expect(page.locator("#bulkDataImportPanel")).toContainText(
    "Импортировать людей и заполненные поля"
  );
  await page.locator('[data-bulk-v2-source="paste"]').click();
  await expect(page.locator("#bulkV2PasteSource")).toBeVisible();
  await page.locator("#bulkV2Paste").fill(
    "ФИО\tТабельный номер\tДолжность\nАнна Смирнова\tT-001\tИнженер\nИван Петров\tT-002\tАналитик"
  );
  await page.locator("#bulkV2PastePreview").click();

  await expect(page.locator("#bulkImportMessage")).toContainText("Таблица прочитана");
  await expect(page.locator("#bulkImportMappings")).toContainText("Класс данных");
  await expect(page.locator("#bulkImportMappings")).toContainText(/совпадение|Новое поле/u);
  const positionRow = page.locator('[data-bulk-mapping-row][data-column="Должность"]');
  await positionRow.locator("[data-bulk-mapping-mode]").selectOption("create");
  await positionRow.locator("[data-bulk-value-type]").selectOption("enum");
  await expect(positionRow.locator("[data-bulk-enum-fields]")).toBeVisible();
  await expect(positionRow.locator("[data-bulk-enum-values]")).toHaveValue(
    /Инженер|Аналитик/u
  );
  await page.locator("#bulkImportCreateGroup").check();
  await page.locator("#bulkImportGroupName").fill("Учебная группа М-21");
  await page.locator("#bulkImportPlanButton").click();
  await expect(page.locator("#bulkImportPlan")).toContainText("Новые");
  await page.locator("#bulkImportExecute").click();
  await expect(page.locator("#bulkImportMessage")).toContainText("Импорт завершён");
  expect(state.importBodies).toHaveLength(1);
  expect(state.importBodies[0].mappings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        column: "Должность",
        valueType: "enum",
        allowCustom: true,
        enumValues: expect.arrayContaining(["Инженер", "Аналитик"])
      })
    ])
  );
});
