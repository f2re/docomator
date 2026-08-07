import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

async function openImport(page) {
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("employees");
  await page.locator("[data-bulk-import-open]:visible").first().click();
  await expect(page.locator("#bulkDataImportPanel")).toBeVisible();
}

test("принимает CSV/XLSX перетаскиванием и не растягивает настройку полей", async ({
  page
}) => {
  await installDocomatorApiMock(page);
  await openImport(page);

  const dropZone = page.locator(".bulk-import-drop-zone");
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

test("ошибка импорта подсвечивает колонку и даёт переход к исправлению", async ({
  page
}) => {
  await installDocomatorApiMock(page, {
    importPreview: {
      fileName: "Сотрудники.xlsx",
      fileFormat: "xlsx",
      sourceSha256: "e2e-field-error-source",
      previewToken: "e2e-field-error-token",
      headers: ["ФИО", "Табельный номер", "Возраст"],
      columnCount: 3,
      rowCount: 1,
      rows: [
        {
          "ФИО": "Анна Смирнова",
          "Табельный номер": "T-001",
          "Возраст": "abc"
        }
      ],
      sourceRowNumbers: [2],
      sampleRows: [
        {
          "ФИО": "Анна Смирнова",
          "Табельный номер": "T-001",
          "Возраст": "abc"
        }
      ],
      sampleRowNumbers: [2],
      warnings: []
    }
  });
  await page.route("**/data-import/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          rowCount: 1,
          createdCount: 0,
          updatedCount: 0,
          unchangedCount: 0,
          skippedCount: 0,
          failedCount: 1,
          errors: [
            {
              rowNumber: 2,
              externalKey: "T-001",
              message: "Значение «abc» не является числом"
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
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("e2e-xlsx-placeholder", "utf8")
  });
  await page.locator("#bulkImportPreviewButton").click();

  const ageRow = page
    .locator("[data-bulk-mapping-row]")
    .filter({ hasText: "Возраст" });
  await ageRow.locator("[data-bulk-mapping-mode]").selectOption("create");
  await ageRow.locator("[data-bulk-value-type]").selectOption("number");
  await page.locator("#bulkImportPlanButton").click();

  await expect(ageRow).toHaveClass(/has-import-error/u);
  await expect(ageRow).toContainText("1 ошибка");
  const fix = page.locator('[data-bulk-fix-column="Возраст"]');
  await expect(fix).toBeVisible();
  await expect(page.locator("#bulkImportPlan")).toContainText(
    "Если в колонке находятся коды или номера"
  );

  await fix.click();
  await expect(ageRow.locator("[data-bulk-value-type]")).toBeFocused();
});

test("запросы определений полей автоматически получают текущее пространство", async ({
  page
}) => {
  await installDocomatorApiMock(page);
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
