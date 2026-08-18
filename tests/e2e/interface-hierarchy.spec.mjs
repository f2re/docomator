import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

const failedOperation = {
  id: "document_generation:interface-failed",
  kind: "document_generation",
  state: "failed",
  title: "Форма рецензии",
  format: "docx",
  progress: { expected: 4, completed: 3, failed: 1 },
  attempts: 1,
  maxAttempts: 3,
  nextAttemptAt: null,
  failureReason: "В одной карточке отсутствует обязательное поле.",
  correlationId: "e2e-interface-failed",
  createdAt: "2026-07-26T05:00:00.000Z",
  completedAt: "2026-07-26T05:01:00.000Z",
  updatedAt: "2026-07-26T05:01:00.000Z"
};

test("интерфейс показывает компактное состояние, четыре этапа и самостоятельное управление", async ({
  page
}) => {
  await installОформляторApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();

  await expect(page.locator("#systemStatusControl")).toBeVisible();
  await expect(page.locator("#systemStatusControl")).toContainText("Система готова");
  await expect(page.locator("#statusRibbon")).toHaveClass(/is-routine/u);
  await expect(page.locator("#statusRibbon")).not.toBeVisible();

  await expect(page.locator(".path-grid [data-workflow-step]")).toHaveCount(4);
  await expect(page.locator('[data-workflow-step="data"]')).toHaveAttribute(
    "data-state",
    "current"
  );
  await expect(page.locator('[data-workflow-step="results"]')).toContainText(
    "Результат"
  );

  await app.openView("settings");
  await expect(page.locator("#viewTitle")).toHaveText("Управление");
  await expect(page.locator("#managementCurrentSpace")).toHaveText(
    "Отдел разработки"
  );
  await expect(page.locator("[data-management-theme]")).toHaveCount(3);
  await expect(
    page.locator("#managementReadinessMount > #operationsReadinessPanel")
  ).toHaveCount(1);

  await page.locator('[data-management-theme="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator('[data-management-theme="system"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
});

test("ошибки результата подняты над хронологией и отмечены в навигации", async ({
  page
}) => {
  await installОформляторApiMock(page, { operations: [failedOperation] });
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView("documents");

  await expect(page.locator("#operationCenterList .operation-row.is-failed")).toHaveCount(1);
  await expect(page.locator("#resultAttentionSummary")).toBeVisible();
  await expect(page.locator("#resultAttentionSummary")).toContainText(
    "Требуют исправления: 1"
  );
  await expect(
    page.locator('[data-view-target="documents"]:visible [data-interface-attention-badge]')
  ).toHaveText("1");
});

test("настольная навигация оставляет ежедневный маршрут на первом уровне", async ({
  page
}) => {
  await installОформляторApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();

  const navigation = page.locator(".nav-list");
  const overflow = navigation.locator(":scope > .nav-overflow");
  const summary = overflow.locator(":scope > summary");

  await expect
    .poll(() =>
      navigation
        .locator(":scope > [data-view-target]")
        .evaluateAll((items) => items.map((item) => item.dataset.viewTarget))
    )
    .toEqual([
      "overview",
      "employees",
      "templates",
      "generation",
      "documents",
      "automations"
    ]);

  await expect(
    page.locator('.sidebar-footer > [data-view-target="settings"]')
  ).toBeVisible();
  await expect(overflow).not.toHaveAttribute("open", "");
  await expect(overflow.locator('[data-view-target="entities"]')).toHaveCount(1);

  const summaryBox = await summary.boundingBox();
  expect(summaryBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(overflow).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(overflow).not.toHaveAttribute("open", "");

  await app.openView("entities");
  await expect(overflow).toHaveAttribute("open", "");
  await expect(overflow).toHaveClass(/is-current/u);
  await expect(
    overflow.locator('[data-view-target="entities"]')
  ).toHaveAttribute("aria-current", "page");
  await expect(summary).not.toHaveAttribute("aria-current");
});
