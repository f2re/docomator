import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const normalizationPreview = {
  fileName: "Сотрудники.xlsx",
  fileFormat: "xlsx",
  sourceSha256: "e2e-normalization-source-sha256",
  previewToken: "e2e-normalization-preview-token",
  headers: ["Табельный номер", "ФИО", "Подразделение"],
  columnCount: 3,
  rowCount: 2,
  rows: [
    {
      "Табельный номер": "EMP-A1",
      "ФИО": "иВАНОВ иВАН иВАНОВИЧ",
      "Подразделение": "НАУЧНЫЙ ОТДЕЛ"
    },
    {
      "Табельный номер": "emp-a2",
      "ФИО": "пЕТРОВ пЁТР пЕТРОВИЧ",
      "Подразделение": "ОПЕРАТИВНЫЙ ОТДЕЛ"
    }
  ],
  sourceRowNumbers: [17, 28],
  sampleRows: [
    {
      "Табельный номер": "EMP-A1",
      "ФИО": "иВАНОВ иВАН иВАНОВИЧ",
      "Подразделение": "НАУЧНЫЙ ОТДЕЛ"
    },
    {
      "Табельный номер": "emp-a2",
      "ФИО": "пЕТРОВ пЁТР пЕТРОВИЧ",
      "Подразделение": "ОПЕРАТИВНЫЙ ОТДЕЛ"
    }
  ],
  sampleRowNumbers: [17, 28],
  warnings: []
};

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

test("передаёт настройки регистра и разделения ФИО в импорт", async ({ page }) => {
  const state = await installDocomatorApiMock(page, {
    importPreview: normalizationPreview
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("employees");
  await page.locator("[data-bulk-import-open]:visible").first().click();

  await page.locator("#bulkImportFile").setInputFiles({
    name: "Сотрудники.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("e2e-xlsx-placeholder", "utf8")
  });
  await page.locator("#bulkImportPreviewButton").click();

  await expect(page.locator("#bulkImportIdentityCaseInsensitive")).toBeChecked();
  await expect(page.locator("#bulkImportNormalizePersonName")).toBeChecked();
  await page.locator("#bulkImportSplitPersonName").check();
  await expect(page.locator("#bulkImportNameOrderField")).toBeVisible();
  await page
    .locator("#bulkImportNameOrder")
    .selectOption("given-patronymic-family");

  const departmentRow = page
    .locator("[data-bulk-mapping-row]")
    .filter({ hasText: "Подразделение" });
  await departmentRow.locator("[data-bulk-case-insensitive]").check();

  await page.locator("#bulkImportPlanButton").click();
  await expect(page.locator("#bulkImportExecute")).toBeVisible();
  await page.locator("#bulkImportExecute").click();
  await expect(page.locator("#bulkImportMessage")).toContainText(
    "Импорт завершён: добавлено 2"
  );

  expect(state.importBodies).toHaveLength(1);
  const payload = state.importBodies[0];
  expect(payload.identityCaseInsensitive).toBe(true);
  expect(payload.sourceRowNumbers).toEqual([17, 28]);
  expect(payload.personName).toEqual({
    normalizeCase: true,
    split: true,
    sourceOrder: "given-patronymic-family"
  });
  expect(
    payload.mappings.find((mapping) => mapping.column === "Подразделение")
      ?.caseInsensitive
  ).toBe(true);
});
