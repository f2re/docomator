import { expect, test } from "./fixtures/test.mjs";

import { installОформляторApiMock } from "./fixtures/docomator-api.mjs";
import { ОформляторPage } from "./pages/docomator-page.mjs";

async function openFullGuide(page, app) {
  const sidebarButton = page.locator("#helpCenterNavButton:visible");
  if ((await sidebarButton.count()) > 0) {
    await sidebarButton.click();
    return;
  }
  await app.openView("settings");
  await page.locator('[data-view="settings"] [data-help-center-open]').click();
}

test("встроенное руководство открывается, ищет кейсы и ведёт к рабочему разделу", async ({
  page
}) => {
  await installОформляторApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();

  await openFullGuide(page, app);
  await expect(page.locator("#helpCenterView")).toHaveClass(/is-visible/u);
  await expect(page.locator("#viewTitle")).toHaveText("Руководство");
  await expect(page.locator("#helpCenterHeading")).toContainText(
    "Руководство по всем рабочим потокам"
  );

  await page.locator("#helpCenterSearch").fill("студенты темы руководители");
  const studentCard = page
    .locator("[data-help-article]")
    .filter({ hasText: "студенты, темы работ" })
    .first();
  await expect(studentCard).toBeVisible();
  await studentCard.click();

  await expect(page.locator("#helpCenterArticlePane")).toContainText(
    "Номер зачётной книжки"
  );
  await expect(page.locator("#helpCenterArticlePane")).toContainText(
    /один сводный документ/ui
  );

  await page.locator('[data-help-go-view="employees"]').click();
  await expect(page.locator('[data-view="employees"]')).toHaveClass(/is-visible/u);
  await expect(page.locator("#viewTitle")).toHaveText("Сотрудники");
});

test("пункт Руководство повторно открывает обзор, а не последнюю статью", async ({
  page
}) => {
  await installОформляторApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();

  await openFullGuide(page, app);
  await page.locator('[data-help-article="bulk-import"]').first().click();
  await expect(page.locator("#helpCenterArticlePane")).toBeVisible();
  await expect(page.locator("#helpCenterIndexPane")).toBeHidden();

  await openFullGuide(page, app);
  await expect(page.locator("#helpCenterIndexPane")).toBeVisible();
  await expect(page.locator("#helpCenterArticlePane")).toBeHidden();
  await expect(page.locator("#helpCenterHeading")).toContainText(
    "Руководство по всем рабочим потокам"
  );
});

test("контекстная помощь содержит переход к полному локальному руководству", async ({
  page
}) => {
  await installОформляторApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();

  await page.locator("#helpButton:visible, #mobileHelpButton:visible").first().click();
  await expect(page.locator("#helpDrawer")).toHaveClass(/is-open/u);
  await page.locator("#helpDrawer [data-help-center-open]").click();
  await expect(page.locator("#helpCenterView")).toHaveClass(/is-visible/u);
  await expect(page).toHaveURL(/#help$/u);

  await page.reload();
  await expect(page.locator("#helpCenterView")).toHaveClass(/is-visible/u);
  await expect(page.locator("#helpCenterNavButton")).toHaveAttribute(
    "aria-current",
    "page"
  );
});
