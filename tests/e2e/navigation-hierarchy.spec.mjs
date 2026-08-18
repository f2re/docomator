import { expect, test } from "./fixtures/test.mjs";

import { ОформляторPage } from "./pages/docomator-page.mjs";
import { installUiRegressionScenario } from "./ui-regression-inventory.mjs";

const desktopPrimaryViews = [
  "overview",
  "employees",
  "templates",
  "gost-formatting",
  "generation",
  "documents",
  "settings"
];

async function openAuditedWorkspace(page) {
  await installUiRegressionScenario(page);
  const app = new ОформляторPage(page);
  await app.open();
  await expect(
    page.locator('link[data-navigation-hierarchy-contract]')
  ).toHaveAttribute("href", "/ui/navigation-contract.css");
  return app;
}

test("десктопная навигация оставляет только основные задачи", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAuditedWorkspace(page);

  const visibleTargets = await page
    .locator(".nav-list [data-view-target]:visible")
    .evaluateAll((elements) =>
      elements.map((element) => element.dataset.viewTarget).filter(Boolean)
    );

  expect([...visibleTargets].sort()).toEqual([...desktopPrimaryViews].sort());
  await expect(page.locator('.nav-list [data-view-target="entities"]')).toBeHidden();
  await expect(page.locator('.nav-list [data-view-target="automations"]')).toBeHidden();
  await expect(page.locator('.nav-list [data-view-target="publications"]')).toBeHidden();
  await expect(page.locator("#helpCenterNavButton")).toBeHidden();
});

test("редкие инструменты доступны единым реестром Управления", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const app = await openAuditedWorkspace(page);
  await app.openView("settings");

  for (const target of ["entities", "gost-formatting", "publications"]) {
    await expect(
      page.locator(
        `[data-view="settings"] [data-navigation-overflow="${target}"]`
      )
    ).toBeVisible();
  }
  await expect(
    page.locator('[data-view="settings"] [data-view-target="automations"]')
  ).toBeVisible();
  await expect(
    page.locator('[data-view="settings"] [data-help-center-open]')
  ).toHaveCount(1);
  await expect(
    page.locator('[data-view="settings"] [data-navigation-overflow="help"]')
  ).toHaveCount(0);

  await expect
    .poll(() =>
      page
        .locator(".settings-grid.management-grid")
        .evaluate((element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length
        )
    )
    .toBe(1);
});

test("дополнительный раздел сохраняет название экрана и отмечает Управление", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const app = await openAuditedWorkspace(page);
  await app.openView("publications");

  await expect(page.locator("#viewTitle")).toHaveText("Публикации");
  await expect(page.locator('.nav-list [data-view-target="settings"]')).toHaveClass(
    /is-active/u
  );
  await expect(page.locator('.nav-list [data-view-target="settings"]')).toHaveAttribute(
    "aria-current",
    "page"
  );
});

test("повторный заголовок скрывается без потери пояснения экрана", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const app = await openAuditedWorkspace(page);
  await app.openView("gost-formatting");

  await expect(page.locator('.nav-list [data-view-target="gost-formatting"]')).toHaveClass(
    /is-active/u
  );
  const intro = page.locator('[data-view="gost-formatting"] .section-intro').first();
  await expect(intro).toBeVisible();
  await expect(intro.locator("h2")).toBeHidden();
  await expect(intro.locator("p:not(.eyebrow)")).toBeVisible();
});

test("повторный заголовок не скрывает основное действие на узком экране", async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const app = await openAuditedWorkspace(page);

  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await app.openView("employees");

    const intro = page.locator('[data-view="employees"] .section-intro').first();
    await expect(intro).toBeVisible();
    await expect(intro.locator("h2")).toBeHidden();
    await expect(page.locator("#employeeAddButtonHeader")).toBeVisible();
  }
});

test("на телефоне оформление по ГОСТ остаётся доступным через Ещё", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await openAuditedWorkspace(page);
  await app.openView("settings");

  const shortcut = page.locator(
    '[data-view="settings"] [data-navigation-overflow="gost-formatting"]'
  );
  await expect(shortcut).toBeVisible();
  await shortcut.click();

  await expect(page.locator('[data-view="gost-formatting"]')).toHaveClass(/is-visible/u);
  await expect(page.locator('.mobile-nav [data-view-target="settings"]')).toHaveClass(
    /is-active/u
  );
  await expect(page.locator(".mobile-nav button")).toHaveCount(5);
});
