import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

const runningOperation = {
  id: "document_generation:csp-running",
  kind: "document_generation",
  state: "running",
  title: "Проверка CSP",
  format: "docx",
  progress: { expected: 4, completed: 2, failed: 0 },
  attempts: 1,
  maxAttempts: 3,
  nextAttemptAt: null,
  failureReason: null,
  correlationId: "e2e-csp-running",
  createdAt: "2026-07-26T08:00:00.000Z",
  completedAt: null,
  updatedAt: "2026-07-26T08:00:01.000Z"
};

test("рабочие экраны не создают ошибок Content-Security-Policy", async ({ page }) => {
  const violations = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content-Security-Policy|style-src-attr|Refused to apply inline style/iu.test(text)) {
      violations.push(text);
    }
  });

  await installDocomatorApiMock(page, { operations: [runningOperation] });
  const app = new DocomatorPage(page);
  await app.open();
  await app.openView("documents");
  await expect(page.locator("#operationCenterList progress")).toHaveAttribute(
    "value",
    "50"
  );
  await app.openView("templates");
  await app.openView("generation");
  await page.waitForTimeout(100);

  expect(await page.locator("[style]").count()).toBe(0);
  expect(violations).toEqual([]);
});
