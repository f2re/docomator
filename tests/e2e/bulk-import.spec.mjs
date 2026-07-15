import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

test("импортирует список сотрудников без технических ключей", async ({ page }) => {
  const state = await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("employees");
  await page.locator("[data-bulk-import-open]:visible").first().click();

  await expect(page.locator("#bulkDataImportPanel")).toBeVisible();
  await expect(page.locator("#bulkDataImportPanel")).not.toContainText(
    /стабильный ключ|уникальный ключ|технический ключ/iu
  );
  await page.locator("#bulkImportFile").setInputFiles({
    name: "Сотрудники.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "ФИО;Табельный номер;Должность\nАнна Смирнова;T-001;Инженер\nИван Петров;T-002;Аналитик"
    )
  });
  await page.locator("#bulkImportPreviewButton").click();

  await expect(page.locator("#bulkImportMessage")).toContainText(
    "Файл прочитан: 2 строк"
  );
  await expect(page.locator("#bulkImportDisplayNameColumn")).toHaveValue("ФИО");
  await expect(page.locator("#bulkImportIdentityColumn")).toHaveValue(
    "Табельный номер"
  );
  await page.locator("#bulkImportPlanButton").click();
  await expect(page.locator("#bulkImportPlan")).toContainText("Новые");
  await expect(page.locator("#bulkImportPlan")).toContainText("2");
  await page.locator("#bulkImportExecute").click();

  await expect(page.locator("#bulkImportPreview")).toContainText(
    "Список сотрудников обработан"
  );
  await expect(page.locator("#bulkImportMessage")).toContainText(
    "Импорт завершён: добавлено 2"
  );
  expect(state.importBodies).toHaveLength(1);
  expect(JSON.stringify(state.importBodies[0])).not.toMatch(
    /stableKey|propertyKey|technicalKey/u
  );
  await expect(page.locator("#employeeList")).toContainText("Анна Смирнова");
  await expect(page.locator("#employeeList")).toContainText("Иван Петров");
});
