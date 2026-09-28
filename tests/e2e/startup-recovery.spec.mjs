import { expect, test } from "./fixtures/test.mjs";

async function ready(page) {
  await page.goto("/");
  await expect(page.locator("#connectionBadge")).toContainText("Локальный сервер готов");
}

test("запуск на реальном API оставляет цикл событий свободным и статус стабильным", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await ready(page);
  await page.evaluate(() => {
    globalThis.startupStatusMutations = 0;
    new MutationObserver((records) => { globalThis.startupStatusMutations += records.length; })
      .observe(document.querySelector("#statusRibbon"), { attributes: true, childList: true, subtree: true });
  });
  await page.waitForTimeout(500);
  const first = await page.evaluate(() => globalThis.startupStatusMutations);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => globalThis.startupStatusMutations)).toBe(first);
  expect(requests).not.toContain("/api/v1/operations/readiness");
  expect(requests.some((url) => /\/document-schedules|\/document-results|\/template-drafts/.test(url))).toBe(false);
  await page.locator('[data-view-target="employees"]:visible').first().click();
  await expect(page.locator('[data-view="employees"]')).toHaveClass(/is-visible/);
  await page.locator('[data-view-target="overview"]:visible').first().click();
  await expect(page.locator("#refreshButton")).toBeEnabled();
});

test("ошибка соединения завершается явным состоянием и допускает повтор", async ({ page }) => {
  await page.route("**/readyz", (route) => route.abort("connectionrefused"));
  await page.goto("/");
  await expect(page.locator("#statusRibbonTitle")).toHaveText("Не удалось обновить данные");
  await expect(page.locator("#refreshButton")).toBeEnabled();
  await page.unroute("**/readyz");
  await page.locator("#statusRetryButton").click();
  await expect(page.locator("#connectionBadge")).toContainText("Локальный сервер готов");
});

test("медленный GET не держит экран в бесконечной загрузке и сохраняет ввод", async ({ page }) => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/readyz", async (route) => { await held; await route.abort().catch(() => {}); });
  try {
    await page.goto("/");
    await page.locator('[data-view-target="employees"]:visible').first().click();
    await page.locator("#employeeSearch").fill("Несохранённый поиск");
    await expect(page.locator("#statusRibbonTitle")).toHaveText("Не удалось обновить данные", { timeout: 16_000 });
    await expect(page.locator("#employeeSearch")).toHaveValue("Несохранённый поиск");
    await expect(page.locator("#refreshButton")).toBeEnabled();
  } finally { release(); }
});

test("недоступный запрос состояния доступа не создаёт необработанную ошибку", async ({ page }) => {
  await page.route("**/api/v1/access/status", (route) => route.abort("connectionrefused"));
  await ready(page);
  await expect(page.locator("#refreshButton")).toBeEnabled();
});
