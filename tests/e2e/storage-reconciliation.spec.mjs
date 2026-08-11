import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

test("проверка целостности запускается только по кнопке и показывает read-only отчёт", async ({
  page
}) => {
  await installОформляторApiMock(page);
  let reconciliationCalls = 0;
  await page.route("**/api/v1/storage/reconciliation*", async (route) => {
    reconciliationCalls += 1;
    await route.fulfill({
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        data: {
          generatedAt: "2026-08-01T08:00:00.000Z",
          healthy: false,
          objectStorePresent: true,
          databaseObjectCount: 8,
          databaseObjectBytes: 1_048_576,
          physicalObjectCount: 9,
          physicalObjectBytes: 1_049_600,
          matchedObjectCount: 8,
          issueCount: 1,
          detailCount: 1,
          omittedDetailCount: 0,
          issueCounts: {
            objectStoreMissing: 0,
            databaseInvalidSha256: 0,
            databaseObjectMissing: 0,
            databaseSizeMismatch: 0,
            databaseStoragePathMismatch: 0,
            physicalObjectUnregistered: 1,
            physicalChecksumMismatch: 0,
            invalidLayout: 0,
            nonRegularEntry: 0,
            incomingEntry: 0,
            unreadableEntry: 0
          },
          issues: [
            {
              kind: "physical_object_unregistered",
              relativePath: "ab/cd/abcdef",
              fileId: null,
              sha256: "abcdef",
              actualSha256: "abcdef",
              expectedSizeBytes: null,
              actualSizeBytes: 1_024,
              message: "Физический объект отсутствует в таблице files."
            }
          ]
        },
        correlationId: "e2e-storage-reconciliation"
      })
    });
  });

  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("documents");

  await expect(page.locator("#storageMaintenancePanel")).toBeVisible();
  await expect(page.locator("#storageReconciliationRun")).toBeVisible();
  expect(reconciliationCalls).toBe(0);

  await page.locator("#storageReconciliationRun").click();

  await expect(page.locator("#storageReconciliationReport")).toContainText(
    "Обнаружено нарушений: 1"
  );
  await expect(page.locator("#storageReconciliationReport")).toContainText(
    "Файл отсутствует в SQLite"
  );
  await expect(page.locator("#storageReconciliationReport")).toContainText(
    "Проверка ничего не изменяла"
  );
  await expect(page.locator("#storageReconciliationReport")).not.toContainText(
    "Удалить"
  );
  expect(reconciliationCalls).toBe(1);
});
