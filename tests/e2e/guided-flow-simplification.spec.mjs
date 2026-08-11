import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

test("шаблон автоматически проверяется и строит структуру без лишних кнопок", async ({
  page
}) => {
  await installОформляторApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("templates");

  await page.locator("#documentIntakeFile").setInputFiles({
    name: "Личная карточка.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("controlled-auto-intake-docx-fixture")
  });

  await expect(page.locator("#documentIntakeStatusTitle")).toHaveText(
    "Структура прошла проверку",
    { timeout: 6_000 }
  );
  await expect(page.locator("#documentIntakeButton")).toBeHidden();
  await expect(page.locator("#documentQuarantineButton")).toBeEnabled();

  await page.locator("#documentQuarantineButton").click();
  await expect(page.locator('[data-template-step="2"]')).toHaveAttribute(
    "data-wizard-state",
    "current"
  );

  await expect(page.locator(".structure-element").first()).toBeVisible({
    timeout: 6_000
  });
  await expect(page.locator("#documentStructureButton")).toHaveText(
    "Построить заново"
  );
});

test("CSV или XLSX автоматически читается после выбора файла", async ({ page }) => {
  await installОформляторApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("employees");
  await page.locator("[data-bulk-import-open]:visible").first().click();

  await page.locator("#bulkImportFile").setInputFiles({
    name: "Сотрудники.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "ФИО;Табельный номер;Должность\nАнна Смирнова;T-001;Инженер\nИван Петров;T-002;Аналитик"
    )
  });

  await expect(page.locator("#bulkImportMessage")).toContainText(
    "Файл прочитан: 2 строк",
    { timeout: 6_000 }
  );
  await expect(page.locator("#bulkImportDisplayNameColumn")).toHaveValue("ФИО");
  await expect(page.locator("#bulkImportIdentityColumn")).toHaveValue(
    "Табельный номер"
  );
  await expect(page.locator("#bulkImportPlanButton")).toBeVisible();
});
