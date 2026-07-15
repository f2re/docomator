import { expect, test } from "./fixtures/test.mjs";

import {
  E2E_SECOND_SPACE_ID,
  E2E_SPACE_ID,
  installDocomatorApiMock
} from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const operationBase = {
  format: "docx",
  attempts: 1,
  maxAttempts: 3,
  nextAttemptAt: null,
  failureReason: null,
  correlationId: "e2e-operation-correlation",
  createdAt: "2026-07-15T09:00:00.000Z",
  completedAt: null,
  updatedAt: "2026-07-15T09:05:00.000Z"
};

const operations = [
  {
    ...operationBase,
    id: "template_preview:preview-failed",
    kind: "template_preview",
    state: "failed",
    title: "Приказ о приёме",
    progress: { expected: 1, completed: 0, failed: 1 },
    failureReason: "LibreOffice не создал PDF. Проверьте исходный документ.",
    correlationId: "e2e-preview-failed",
    completedAt: "2026-07-15T09:06:00.000Z",
    updatedAt: "2026-07-15T09:06:00.000Z"
  },
  {
    ...operationBase,
    id: "document_generation:generation-running",
    kind: "document_generation",
    state: "running",
    title: "Личные карточки сотрудников",
    progress: { expected: 20, completed: 18, failed: 0 },
    correlationId: "e2e-generation-running",
    updatedAt: "2026-07-15T09:07:00.000Z"
  },
  {
    ...operationBase,
    id: "email_delivery:email-retry",
    kind: "email_delivery",
    state: "retry",
    title: "Комплект отдела кадров",
    progress: { expected: 1, completed: 0, failed: 0 },
    nextAttemptAt: "2026-07-15T09:15:00.000Z",
    correlationId: "e2e-email-retry",
    updatedAt: "2026-07-15T09:08:00.000Z"
  },
  {
    ...operationBase,
    id: "network_delivery:network-completed",
    kind: "network_delivery",
    state: "completed",
    title: "Личные карточки сотрудников",
    progress: { expected: 1, completed: 1, failed: 0 },
    correlationId: "e2e-network-completed",
    completedAt: "2026-07-15T09:09:00.000Z",
    updatedAt: "2026-07-15T09:09:00.000Z"
  }
];

test("центр восстанавливает операции после перезагрузки и изолирует пространства", async ({
  page
}) => {
  const scenario = await installDocomatorApiMock(page, {
    operations,
    secondSpace: true
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("documents");

  await expect(page.locator("#documents-heading")).toHaveText(
    "Результаты и операции"
  );
  await expect(page.locator("#operationCenterList .operation-row")).toHaveCount(4);
  await expect(page.locator("#operationCenterList")).toContainText(
    "Личные карточки сотрудников"
  );
  await expect(page.locator("#operationCenterList")).toContainText(
    "Готово 18 из 20"
  );
  await expect(page.locator("#operationCenterList")).toContainText(
    "Повтор запланирован"
  );
  await expect(page.locator("#operationCenterList")).toContainText(
    "Нужно внимание"
  );
  await expect(
    page.locator("#operationCenterList .operation-row").first()
  ).toHaveClass(/is-failed/u);

  const action = page
    .locator('#operationCenterList [data-operation-view="templates"]')
    .first();
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  expect(box.height).toBeGreaterThanOrEqual(44);

  const requestsBeforeReload = scenario.operationRequests.length;
  await page.reload();
  await expect(page.locator('[data-view="documents"]')).toHaveClass(/is-visible/u);
  await expect(page.locator("#operationCenterList .operation-row")).toHaveCount(4);
  expect(scenario.operationRequests.length).toBeGreaterThan(requestsBeforeReload);
  await expect(page.locator("#operationCenterList details").first()).not.toHaveAttribute(
    "open",
    ""
  );

  await app.openView("settings");
  await app.openView("spaces");
  await page.locator(`[data-space-id="${E2E_SECOND_SPACE_ID}"]`).click();
  await app.openView("documents");
  await expect(page.locator("#operationCenterList")).toContainText(
    "Операций пока нет"
  );
  await expect(page.locator("#operationCenterList .operation-row")).toHaveCount(0);

  await app.openView("settings");
  await app.openView("spaces");
  await page.locator(`[data-space-id="${E2E_SPACE_ID}"]`).click();
  await app.openView("documents");
  await expect(page.locator("#operationCenterList .operation-row")).toHaveCount(4);
  expect(
    scenario.operationRequests.some(
      (request) => request.spaceId === E2E_SECOND_SPACE_ID
    )
  ).toBe(true);
});

test("ошибка чтения операций сохраняет понятный повтор и идентификатор", async ({
  page
}) => {
  await installDocomatorApiMock(page, {
    operations,
    failOperationsOnce: true
  });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("documents");

  await expect(page.locator("#operationCenterList")).toContainText(
    "Не удалось получить операции"
  );
  await expect(page.locator("#operationCenter")).toContainText(
    "Запущенная работа не остановлена"
  );
  await page.locator("#operationCenterRetry").click();
  await expect(page.locator("#operationCenterList .operation-row")).toHaveCount(4);
});
