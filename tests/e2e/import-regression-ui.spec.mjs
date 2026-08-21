import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

async function openImport(page) {
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("employees");
  await page.locator("[data-bulk-import-open]:visible").first().click();
  await expect(page.locator("#bulkDataImportPanel")).toBeVisible();
}

function compositePreview() {
  const rows = [
    ["Анна Смирнова", "T-001", "мать, брат"],
    ["Иван Петров", "T-002", "отец, мать"],
    ["Олег Сидоров", "T-003", "мать, брат"],
    ["Мария Орлова", "T-004", "отец, мать, брат"],
    ["Пётр Волков", "T-005", "мать, брат"],
    ["Елена Крылова", "T-006", "отец, мать"],
    ["Нина Белова", "T-007", "мать, брат"],
    ["Илья Морозов", "T-008", "отец, мать, брат"]
  ].map(([name, key, family]) => ({
    "ФИО": name,
    "Табельный номер": key,
    "Состав семьи": family
  }));
  return {
    fileName: "Сотрудники.xlsx",
    fileFormat: "xlsx",
    sourceSha256: "e2e-composite-values-source",
    previewToken: "e2e-composite-values-token",
    headers: ["ФИО", "Табельный номер", "Состав семьи"],
    columnCount: 3,
    rowCount: rows.length,
    rows,
    sourceRowNumbers: rows.map((_, index) => index + 2),
    sampleRows: rows,
    sampleRowNumbers: rows.map((_, index) => index + 2),
    warnings: []
  };
}

test("версия видна в оболочке, а составные значения не превращаются в сломанный список", async ({ page }) => {
  await installОформляторApiMock(page, { importPreview: compositePreview() });
  await openImport(page);

  await expect(page.locator(".brand small")).toHaveText(/Версия \d+\.\d+\.\d+.*локально/u);

  await page.locator("#bulkImportFile").setInputFiles({
    name: "Сотрудники.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("e2e-xlsx-placeholder", "utf8")
  });
  await page.locator("#bulkImportPreviewButton").click();

  const familyRow = page
    .locator("[data-bulk-mapping-row]")
    .filter({ hasText: "Состав семьи" });
  await expect(familyRow.locator("[data-bulk-value-type]")).toHaveValue("string");

  await familyRow.locator("[data-bulk-value-type]").selectOption("enum");
  const checkbox = familyRow.locator("[data-bulk-allow-custom]");
  await expect(checkbox).toBeVisible();
  const checkboxBox = await checkbox.boundingBox();
  expect(checkboxBox).not.toBeNull();
  expect(checkboxBox.width).toBeLessThanOrEqual(22);
  expect(checkboxBox.height).toBeLessThanOrEqual(22);

  await familyRow.locator("[data-bulk-enum-values]").fill(
    "мать, брат\nмать, брат\nотец, мать\nотец, мать, брат"
  );

  let submitted = null;
  await page.route("**/data-import/plan", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          rowCount: 8,
          createdCount: 8,
          updatedCount: 0,
          unchangedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          errors: []
        },
        correlationId: "e2e-composite-plan"
      })
    });
  });

  await page.locator("#bulkImportPlanButton").click();
  await expect.poll(() => submitted).not.toBeNull();
  const mapping = submitted.mappings.find((item) => item.column === "Состав семьи");
  expect(mapping.enumValues).toEqual([
    "мать, брат",
    "отец, мать",
    "отец, мать, брат"
  ]);

  const geometry = await page.locator("#bulkDataImportPanel").evaluate((panel) => ({
    clientWidth: panel.clientWidth,
    scrollWidth: panel.scrollWidth
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 2);
});

test("безопасное исправление типа выполняется одной кнопкой и повторяет проверку", async ({ page }) => {
  await installОформляторApiMock(page, {
    importPreview: {
      fileName: "Сотрудники.xlsx",
      fileFormat: "xlsx",
      sourceSha256: "e2e-auto-repair-source",
      previewToken: "e2e-auto-repair-token",
      headers: ["ФИО", "Табельный номер", "Возраст"],
      columnCount: 3,
      rowCount: 2,
      rows: [
        { "ФИО": "Анна Смирнова", "Табельный номер": "T-001", "Возраст": "abc" },
        { "ФИО": "Иван Петров", "Табельный номер": "T-002", "Возраст": "42" }
      ],
      sourceRowNumbers: [17, 28],
      sampleRows: [
        { "ФИО": "Анна Смирнова", "Табельный номер": "T-001", "Возраст": "abc" },
        { "ФИО": "Иван Петров", "Табельный номер": "T-002", "Возраст": "42" }
      ],
      sampleRowNumbers: [17, 28],
      warnings: []
    }
  });

  let planCalls = 0;
  await page.route("**/data-import/plan", async (route) => {
    planCalls += 1;
    const body = route.request().postDataJSON();
    const age = body.mappings.find((item) => item.column === "Возраст");
    const failed = age?.valueType === "number";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: failed
          ? {
              rowCount: 2,
              createdCount: 1,
              updatedCount: 0,
              unchangedCount: 0,
              skippedCount: 0,
              failedCount: 1,
              errors: [
                {
                  rowNumber: 17,
                  externalKey: "T-001",
                  code: "invalid_number",
                  scope: "cell",
                  blockingEffect: "row",
                  column: "Возраст",
                  propertyKey: "employee_field.age",
                  rawValue: "abc",
                  severity: "error",
                  message: "«abc» не является числом.",
                  suggestedAction: "Если это код или номер, выберите текстовый тип. Если это число — исправьте значение в таблице.",
                  repair: {
                    kind: "change_field_type",
                    column: "Возраст",
                    propertyKey: "employee_field.age"
                  }
                }
              ]
            }
          : {
              rowCount: 2,
              createdCount: 2,
              updatedCount: 0,
              unchangedCount: 0,
              skippedCount: 0,
              failedCount: 0,
              errors: []
            },
        correlationId: `e2e-auto-repair-${planCalls}`
      })
    });
  });

  await openImport(page);
  await page.locator("#bulkImportFile").setInputFiles({
    name: "Сотрудники.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("e2e-xlsx-placeholder", "utf8")
  });
  await page.locator("#bulkImportPreviewButton").click();

  const ageRow = page.locator("[data-bulk-mapping-row]").filter({ hasText: "Возраст" });
  await ageRow.locator("[data-bulk-mapping-mode]").selectOption("create");
  await ageRow.locator("[data-bulk-value-type]").selectOption("number");
  await page.locator("#bulkImportPlanButton").click();

  const autoFix = page.locator('[data-guided-fix-column="Возраст"]');
  await expect(autoFix).toHaveText("Исправить автоматически");
  await expect(page.locator("#bulkImportPlan")).toContainText("Строка 17 · Возраст");
  await expect(page.locator("#bulkImportPlan")).toContainText("Значение: «abc»");

  await autoFix.click();
  await expect(ageRow.locator("[data-bulk-value-type]")).toHaveValue("string");
  await expect.poll(() => planCalls).toBe(2);
  await expect(page.locator('[data-guided-fix-column="Возраст"]')).toHaveCount(0);
  await expect(page.locator("#bulkImportPlan")).not.toContainText("«abc» не является числом");
});
