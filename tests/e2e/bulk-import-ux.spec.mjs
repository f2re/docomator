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

test("принимает CSV/XLSX перетаскиванием и не растягивает настройку полей", async ({
  page
}) => {
  await installОформляторApiMock(page);
  await openImport(page);

  const dropZone = page.locator("#bulkDataImportPanel .bulk-import-drop-zone");
  await expect(dropZone).toBeVisible();
  await expect(dropZone).toContainText("Перетащите Excel или CSV сюда");

  await dropZone.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [
          "ФИО;Табельный номер;Должность\nАнна Смирнова;T-001;Инженер\nИван Петров;T-002;Аналитик"
        ],
        "Сотрудники.csv",
        { type: "text/csv" }
      )
    );
    element.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      })
    );
  });

  await expect(page.locator("#bulkImportMessage")).toContainText("Файл выбран");
  expect(
    await page.locator("#bulkImportFile").evaluate((input) => input.files?.[0]?.name)
  ).toBe("Сотрудники.csv");

  await page.locator("#bulkImportPreviewButton").click();
  await expect(page.locator("[data-bulk-mapping-row]")).toHaveCount(3);

  const geometry = await page.locator("#bulkDataImportPanel").evaluate((panel) => ({
    clientWidth: panel.clientWidth,
    scrollWidth: panel.scrollWidth
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 2);
});

test("typed ошибка подсвечивает поле и точную ячейку, а корректные строки остаются доступными", async ({
  page
}) => {
  await installОформляторApiMock(page, {
    importPreview: {
      fileName: "Сотрудники.xlsx",
      fileFormat: "xlsx",
      sourceSha256: "e2e-field-error-source",
      previewToken: "e2e-field-error-token",
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
  await page.route("**/data-import/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
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
              repair: { kind: "change_field_type", column: "Возраст", propertyKey: "employee_field.age" }
            }
          ]
        },
        correlationId: "e2e-import-field-error"
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

  await expect(ageRow).toHaveClass(/has-import-error/u);
  await expect(ageRow.locator("[data-bulk-value-type]")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#bulkImportPlan")).toContainText("Строка 17 · Возраст");
  await expect(page.locator("#bulkImportPlan")).toContainText("Значение: «abc»");
  await expect(page.locator("#bulkImportPlan")).toContainText("Если это код или номер");
  await expect(page.locator('[data-source-row-number="17"] [data-source-column="Возраст"]')).toHaveClass(/has-import-error-cell/u);
  await expect(page.locator(".bulk-import-source-preview")).toHaveAttribute("open", "");
  await expect(page.locator("#bulkImportExecute")).toBeEnabled();
  await expect(page.locator("#bulkImportExecute")).toHaveText("Импортировать 1 корректных строк");

  const fix = page.locator('[data-bulk-fix-column="Возраст"]');
  await fix.click();
  await expect(ageRow.locator("[data-bulk-value-type]")).toBeFocused();
});

test("mapping error uses structured column metadata and does not reset the preview", async ({ page }) => {
  await installОформляторApiMock(page, {
    importPreview: {
      fileName: "Сотрудники.xlsx",
      fileFormat: "xlsx",
      sourceSha256: "e2e-mapping-source",
      previewToken: "e2e-mapping-token",
      headers: ["ФИО", "Табельный номер", "Возраст"],
      columnCount: 3,
      rowCount: 1,
      rows: [{ "ФИО": "Анна Смирнова", "Табельный номер": "T-001", "Возраст": "35" }],
      sourceRowNumbers: [2],
      sampleRows: [{ "ФИО": "Анна Смирнова", "Табельный номер": "T-001", "Возраст": "35" }],
      sampleRowNumbers: [2],
      warnings: []
    }
  });
  await page.route("**/data-import/plan", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "mapping_type_mismatch",
          message: "Колонка сопоставлена с полем другого типа.",
          issue: {
            code: "mapping_type_mismatch",
            scope: "mapping",
            blockingEffect: "mapping",
            severity: "error",
            column: "Возраст",
            propertyKey: "employee_field.age",
            message: "Колонка сопоставлена с полем другого типа.",
            suggestedAction: "Выберите поле подходящего типа либо измените тип создаваемого поля.",
            repair: { kind: "change_field_type", column: "Возраст", propertyKey: "employee_field.age" }
          }
        },
        correlationId: "e2e-mapping-error"
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
  await ageRow.locator("[data-bulk-value-type]").selectOption("string");
  await page.locator("#bulkImportPlanButton").click();

  await expect(ageRow).toHaveClass(/has-import-error/u);
  await expect(ageRow.locator("[data-bulk-value-type]")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#bulkImportPlan")).toContainText("Выберите поле подходящего типа");
  await expect(page.locator("#bulkImportPreview")).toContainText("Сотрудники.xlsx");
  expect(await page.locator("#bulkImportFile").evaluate((input) => input.files?.[0]?.name)).toBe("Сотрудники.xlsx");
});

test("legacy XLS gives a concrete recovery action and keeps the selected file", async ({ page }) => {
  await installОформляторApiMock(page);
  await page.route("**/data-import/preview?*", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "unsupported_legacy_xls",
          message: "Файл сохранён в старом формате Excel 97–2003 (.xls).",
          issue: {
            code: "unsupported_legacy_xls",
            scope: "file",
            blockingEffect: "file",
            severity: "error",
            message: "Файл сохранён в старом формате Excel 97–2003 (.xls).",
            suggestedAction: "Откройте файл в Excel или LibreOffice, сохраните как XLSX или CSV и выберите сохранённую копию.",
            repair: { kind: "replace_file", acceptedFormats: ["CSV", "XLSX"] }
          }
        },
        correlationId: "e2e-xls-error"
      })
    });
  });
  await openImport(page);
  await page.locator("#bulkImportFile").setInputFiles({
    name: "Сотрудники.xls",
    mimeType: "application/vnd.ms-excel",
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  });
  await page.locator("#bulkImportPreviewButton").click();
  await expect(page.locator("#bulkImportMessage")).toContainText("Excel 97–2003");
  await expect(page.locator("#bulkImportRecoveryHint")).toContainText("сохраните как XLSX или CSV");
  expect(await page.locator("#bulkImportFile").evaluate((input) => input.files?.[0]?.name)).toBe("Сотрудники.xls");
});

test("запросы определений полей автоматически получают текущее пространство", async ({
  page
}) => {
  await installОформляторApiMock(page);
  await openImport(page);
  const requested = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/knowledge/property-definitions")) {
      requested.push(request.url());
    }
  });

  await page.evaluate(async () => {
    await fetch("/api/v1/knowledge/property-definitions?limit=500");
  });

  expect(requested.at(-1)).toMatch(/spaceId=00000000-0000-4000-8000-000000000001/u);
});
