import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixtures/test.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

const realStackEnabled = process.env.DOCOMATOR_E2E_REAL_STACK === "1";
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const xlsxFixture = path.join(currentDirectory, "fixtures", "import-employees.xlsx");

async function openEmployeeImport(page) {
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("employees");
  const openButton = page.locator("[data-bulk-import-open]:visible").first();
  await expect(openButton).toBeVisible({ timeout: 20_000 });
  await openButton.click();
  await expect(page.locator("#bulkDataImportPanel")).toBeVisible();
  return app;
}

async function configureTextMapping(page, column) {
  const row = page.locator(
    `[data-bulk-mapping-row][data-column="${column}"]`
  );
  await expect(row).toBeVisible();
  await row.locator("[data-bulk-mapping-mode]").selectOption("create");
  await row.locator("[data-bulk-value-type]").selectOption("string");
}

async function planAndExecute(page) {
  await page.locator("#bulkImportPlanButton").click();
  await expect(page.locator("#bulkImportPlan")).toContainText("Новые", {
    timeout: 20_000
  });
  const execute = page.locator("#bulkImportExecute");
  await expect(execute).toBeEnabled();
  await execute.click();
  await expect(page.locator("#bulkImportMessage")).toContainText(
    "Импорт завершён",
    { timeout: 30_000 }
  );
}

async function pasteImport(page, text, fieldColumn) {
  await page.locator('[data-bulk-import-source="paste"]').click();
  await page.locator("#bulkImportPaste").fill(text);
  await page.locator("#bulkImportPastePreview").click();
  await expect(page.locator("#bulkImportMessage")).toContainText(
    "Таблица прочитана",
    { timeout: 20_000 }
  );
  await configureTextMapping(page, fieldColumn);
  await planAndExecute(page);
}

async function fileImport(page, file, fieldColumn) {
  await page.locator('[data-bulk-import-source="file"]').click();
  await page.locator("#bulkImportFile").setInputFiles(file);
  await page.locator("#bulkImportPreviewButton").click();
  await expect(page.locator("#bulkImportMessage")).toContainText(
    "Файл прочитан",
    { timeout: 20_000 }
  );
  await configureTextMapping(page, fieldColumn);
  await planAndExecute(page);
}

async function csvImport(page, fileName, text, fieldColumn) {
  await fileImport(
    page,
    {
      name: fileName,
      mimeType: "text/csv",
      buffer: Buffer.from(text, "utf8")
    },
    fieldColumn
  );
}

async function expectEmployeeField(page, displayName, fieldLabel, fieldValue) {
  const row = page
    .locator("[data-employee-id]")
    .filter({ hasText: displayName });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  await row.first().click();
  const dialog = page.getByRole("dialog", { name: "Карточка сотрудника" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(fieldLabel)).toHaveValue(fieldValue);
  await dialog.getByRole("button", { name: "Закрыть" }).click();
}

test("вставленная TSV-таблица реально импортируется и повторно обновляет ту же запись", async ({
  page
}) => {
  test.skip(
    !realStackEnabled,
    "Сценарий запускается только с настоящими API и SQLite."
  );
  test.setTimeout(120_000);

  await openEmployeeImport(page);
  const suffix = randomUUID().slice(0, 8);
  const displayName = `Петров Пётр ${suffix}`;
  const externalKey = `T-${suffix}`;
  const fieldColumn = `Должность ${suffix}`;

  await pasteImport(
    page,
    `ФИО\tТабельный номер\t${fieldColumn}\n${displayName}\t${externalKey}\tИнженер`,
    fieldColumn
  );
  await expectEmployeeField(page, displayName, fieldColumn, "Инженер");

  await page.locator("#bulkImportAnother").click();
  await pasteImport(
    page,
    `ФИО\tТабельный номер\t${fieldColumn}\n${displayName}\t${externalKey}\tВедущий инженер`,
    fieldColumn
  );
  await expect(page.locator("#bulkImportMessage")).toContainText("обновлено 1");
  await expectEmployeeField(page, displayName, fieldColumn, "Ведущий инженер");
});

test("CSV file-flow через настоящий API и SQLite остаётся рабочим", async ({ page }) => {
  test.skip(
    !realStackEnabled,
    "Сценарий запускается только с настоящими API и SQLite."
  );
  test.setTimeout(90_000);

  await openEmployeeImport(page);
  const suffix = randomUUID().slice(0, 8);
  const displayName = `Смирнова Анна ${suffix}`;
  const fieldColumn = `Подразделение ${suffix}`;
  await csvImport(
    page,
    `employees-${suffix}.csv`,
    `ФИО;Табельный номер;${fieldColumn}\n${displayName};CSV-${suffix};Лаборатория`,
    fieldColumn
  );
  await expectEmployeeField(page, displayName, fieldColumn, "Лаборатория");
});

test("XLSX file-flow через настоящий API и SQLite остаётся рабочим", async ({ page }) => {
  test.skip(
    !realStackEnabled,
    "Сценарий запускается только с настоящими API и SQLite."
  );
  test.setTimeout(90_000);

  await openEmployeeImport(page);
  await fileImport(page, xlsxFixture, "Подразделение XLSX");
  await expectEmployeeField(
    page,
    "Орлова Ольга XLSX-REAL",
    "Подразделение XLSX",
    "Испытательная лаборатория"
  );
});
