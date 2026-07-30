import { expect, test } from "./fixtures/test.mjs";

import { installDocomatorApiMock } from "./fixtures/docomator-api.mjs";
import { DocomatorPage } from "./pages/docomator-page.mjs";

async function openMockedWorkspace(page) {
  await installDocomatorApiMock(page);
  const app = new DocomatorPage(page);
  await app.open();
  return app;
}

test("рабочий стол использует документную композицию без маркетингового hero", async ({
  page
}) => {
  await openMockedWorkspace(page);

  await expect(page.locator(".home-hero .hero-visual")).toBeHidden();
  await expect(page.locator(".home-hero .pill-accent")).toHaveText(/Текущ|Следующ/u);
  await expect(page.locator(".path-grid .path-card")).toHaveCount(4);

  const styles = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const sidebar = getComputedStyle(document.querySelector(".sidebar"));
    const hero = getComputedStyle(document.querySelector(".home-hero"));
    const route = getComputedStyle(document.querySelector(".path-grid"));
    return {
      bodyBackgroundImage: body.backgroundImage,
      sidebarBackdropFilter: sidebar.backdropFilter,
      heroRadius: hero.borderRadius,
      routeColumns: route.gridTemplateColumns
    };
  });

  expect(styles.bodyBackgroundImage).toBe("none");
  expect(styles.sidebarBackdropFilter).toBe("none");
  expect(parseFloat(styles.heroRadius)).toBeLessThanOrEqual(12);
  expect(styles.routeColumns.split(" ")).toHaveLength(1);
});

test("узкая верхняя панель не обрезает название раздела", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const app = await openMockedWorkspace(page);
  await app.openView("employees");

  await expect(page.locator("#viewTitle")).toHaveText("Сотрудники");
  const layout = await page.evaluate(() => {
    const title = document.querySelector("#viewTitle");
    const actions = document.querySelector(".topbar-actions");
    const titleBox = title.getBoundingClientRect();
    const actionsBox = actions.getBoundingClientRect();
    return {
      titleFits: title.scrollWidth <= title.clientWidth + 1,
      actionsBelowTitle: actionsBox.top >= titleBox.bottom - 1,
      pageFits: document.documentElement.scrollWidth <= window.innerWidth + 1
    };
  });

  expect(layout.titleFits).toBe(true);
  expect(layout.actionsBelowTitle).toBe(true);
  expect(layout.pageFits).toBe(true);
});

test("экран выпуска не повторяет заголовок верхней панели", async ({ page }) => {
  const app = await openMockedWorkspace(page);
  await app.openView("generation");

  await expect(page.locator("#viewTitle")).toHaveText("Создать документы");
  await expect(page.locator("[data-view='generation'] .generation-heading")).toBeHidden();
  await expect(page.locator(".generation-step-rail")).toBeVisible();
});

test("на телефоне пустой отчёт проверки не растягивает первый шаг шаблона", async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const app = await openMockedWorkspace(page);
  await app.openView("templates");

  await expect(page.locator(".intake-panel")).toBeVisible();
  await expect(page.locator(".intake-result-panel")).toBeHidden();
  await expect(page.locator("#documentIntakeButton")).toBeVisible();
});

test("видимый фокус сохраняется на основной навигации", async ({ page }) => {
  await openMockedWorkspace(page);
  const employees = page.locator('.nav-item[data-view-target="employees"]');
  await employees.focus();
  const outline = await employees.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth)
    };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
});
